package com.santhula.rms.common.web;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Optional;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * Where the current request came from, for the audit log (ADR-008 #7): "IP | User-Agent", the
 * User-Agent trimmed so the whole value fits the 300-character column. The IP is the client address
 * as resolved by the server ({@code server.forward-headers-strategy: native} behind nginx). Empty
 * outside an HTTP request (schedulers, start-up).
 */
public final class ClientInfo {

    public static final int MAX_LENGTH = 300;
    static final String SEPARATOR = " | ";

    private ClientInfo() {
    }

    public static Optional<String> current() {
        RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
        if (attributes instanceof ServletRequestAttributes servlet) {
            return Optional.of(of(servlet.getRequest()));
        }
        return Optional.empty();
    }

    static String of(HttpServletRequest request) {
        return format(request.getRemoteAddr(), request.getHeader("User-Agent"));
    }

    static String format(String ip, String userAgent) {
        String address = ip == null || ip.isBlank() ? "unknown" : ip.strip();
        if (address.length() > 64) {
            address = address.substring(0, 64);
        }
        if (userAgent == null || userAgent.isBlank()) {
            return address;
        }
        String agent = userAgent.strip().replaceAll("[\\r\\n\\t]+", " ");
        int room = MAX_LENGTH - address.length() - SEPARATOR.length();
        if (agent.length() > room) {
            agent = agent.substring(0, room);
        }
        return address + SEPARATOR + agent;
    }
}
