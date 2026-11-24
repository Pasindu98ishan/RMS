package com.santhula.rms.support;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.santhula.rms.auth.domain.SystemRole;
import com.santhula.rms.testsupport.MutableClock;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * Base for integration tests: full app (profile `test`), MockMvc through the real security
 * filter chain, Postgres from Testcontainers. Helpers register terminals and log users in the
 * same way the frontend does.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
public abstract class IntegrationTestBase {

    public static final String API = "/api/v1";
    public static final String OWNER = "owner";
    public static final String OWNER_PASSWORD = "owner-test-pass";
    public static final String OWNER_PIN = "1234";
    public static final String PASSWORD = "Password-123";

    private static final AtomicInteger SEQ = new AtomicInteger();

    @Autowired
    protected MockMvc mvc;
    @Autowired
    protected ObjectMapper json;
    @Autowired
    protected MutableClock clock;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        TestDatabase.register(registry);
    }

    @AfterEach
    void resetClock() {
        clock.reset();
    }

    // ------------------------------------------------------------------ data

    public record TerminalKey(UUID id, String deviceToken) {
    }

    public record Session(String accessToken, String refreshToken, UUID terminalId, UUID userId, String username, JsonNode body) {
    }

    protected static String unique(String prefix) {
        return prefix + System.nanoTime() % 1_000_000 + "-" + SEQ.incrementAndGet();
    }

    protected static String uniqueUsername(String prefix) {
        return (prefix + System.nanoTime() % 1_000_000 + "x" + SEQ.incrementAndGet()).toLowerCase();
    }

    /** A different fake client IP per call, so registration rate limits don't leak between tests. */
    protected static String randomIp() {
        int n = SEQ.incrementAndGet();
        return "10." + (n / 65536 % 256) + "." + (n / 256 % 256) + "." + (n % 256);
    }

    protected TerminalKey registerTerminal(String type) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("credentials", Map.of("username", OWNER, "password", OWNER_PASSWORD));
        body.put("name", unique("T-"));
        body.put("type", type);
        if ("KITCHEN".equals(type)) {
            body.put("kitchenStationId", firstActiveStationId());
        }
        JsonNode res = body(mvc.perform(post(API + "/terminals").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(body))).andExpect(status().isCreated()));
        return new TerminalKey(UUID.fromString(res.at("/terminal/id").asText()), res.get("deviceToken").asText());
    }

    /** The id of the first active kitchen station, read the way the terminal-setup screen reads it (no token). */
    protected String firstActiveStationId() throws Exception {
        JsonNode options = body(mvc.perform(post(API + "/terminals/setup-options").contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("username", OWNER, "password", OWNER_PASSWORD)))
                .with(r -> {
                    r.setRemoteAddr(randomIp());
                    return r;
                })).andExpect(status().isOk()));
        return options.get("kitchenStations").get(0).get("id").asText();
    }

    /** Empties the database and re-seeds it (profile `test` endpoint): the M1.1 tests start from a known state. */
    protected void resetDatabase() throws Exception {
        mvc.perform(post(API + "/test/reset")).andExpect(status().isNoContent());
    }

    protected ResultActions loginRequest(String username, String password, TerminalKey terminal) throws Exception {
        return mvc.perform(post(API + "/auth/login")
                .header("X-Terminal-Id", terminal.id().toString())
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("username", username, "password", password,
                        "deviceToken", terminal.deviceToken()))));
    }

    protected Session login(String username, String password, TerminalKey terminal) throws Exception {
        JsonNode res = body(loginRequest(username, password, terminal).andExpect(status().isOk()));
        return new Session(res.get("accessToken").asText(), res.get("refreshToken").asText(), terminal.id(),
                UUID.fromString(res.at("/user/id").asText()), username, res);
    }

    /** Login without a terminal (personal session, ADR-008): no X-Terminal-Id header, no device token. */
    protected ResultActions personalLoginRequest(String username, String password) throws Exception {
        return mvc.perform(post(API + "/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("username", username, "password", password))));
    }

    /** A personal session: {@code terminalId} is null, so requests send no X-Terminal-Id header. */
    protected Session loginPersonal(String username, String password) throws Exception {
        JsonNode res = body(personalLoginRequest(username, password).andExpect(status().isOk()));
        return new Session(res.get("accessToken").asText(), res.get("refreshToken").asText(), null,
                UUID.fromString(res.at("/user/id").asText()), username, res);
    }

    protected Session asOwner() throws Exception {
        return login(OWNER, OWNER_PASSWORD, registerTerminal("ADMIN"));
    }

    /** Creates a user holding one system role and logs them in on a new POS terminal. */
    protected Session asRole(SystemRole role) throws Exception {
        String username = createUser(asOwner(), role, null);
        return login(username, PASSWORD, registerTerminal("CASHIER_POS"));
    }

    /** @return the new username (password {@link #PASSWORD}) */
    protected String createUser(Session owner, SystemRole role, String pin) throws Exception {
        String username = uniqueUsername(role.name().toLowerCase().substring(0, Math.min(3, role.name().length())));
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("username", username);
        body.put("fullName", "Test " + role.name());
        body.put("password", PASSWORD);
        if (pin != null) {
            body.put("pin", pin);
        }
        body.put("roleIds", List.of(role.id().toString()));
        perform(owner, post(API + "/users"), body).andExpect(status().isCreated());
        return username;
    }

    protected UUID userId(Session owner, String username) throws Exception {
        JsonNode page = body(perform(owner, get(API + "/users").param("search", username), null).andExpect(status().isOk()));
        return UUID.fromString(page.at("/items/0/id").asText());
    }

    // ------------------------------------------------------------------ requests

    protected ResultActions perform(Session s, MockHttpServletRequestBuilder req, Object body) throws Exception {
        if (s != null) {
            req.header("Authorization", "Bearer " + s.accessToken());
            if (s.terminalId() != null) {            // a personal session (ADR-008) sends no terminal header
                req.header("X-Terminal-Id", s.terminalId().toString());
            }
        }
        if (body != null) {
            req.contentType(MediaType.APPLICATION_JSON).content(body instanceof String str ? str : json.writeValueAsString(body));
        }
        return mvc.perform(req);
    }

    protected ResultActions doGet(Session s, String path) throws Exception {
        return perform(s, get(API + path), null);
    }

    protected ResultActions doPost(Session s, String path, Object body) throws Exception {
        return perform(s, post(API + path), body);
    }

    protected ResultActions doPut(Session s, String path, Object body) throws Exception {
        return perform(s, put(API + path), body);
    }

    protected ResultActions doDelete(Session s, String path) throws Exception {
        return perform(s, delete(API + path), null);
    }

    protected JsonNode body(ResultActions result) throws Exception {
        String content = result.andReturn().getResponse().getContentAsString();
        return content.isEmpty() ? json.nullNode() : json.readTree(content);
    }
}
