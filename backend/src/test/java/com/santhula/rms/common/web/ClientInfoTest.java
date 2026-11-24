package com.santhula.rms.common.web;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** client_info on audit rows (ADR-008 #7, P1-AUD-01): "IP | User-Agent", never longer than the column. */
class ClientInfoTest {

    @Test
    void ADR008_ipAndAgent() {
        assertThat(ClientInfo.format("203.0.113.7", "Mozilla/5.0 (Android 14)")).isEqualTo("203.0.113.7 | Mozilla/5.0 (Android 14)");
    }

    @Test
    void ADR008_noAgent_isJustTheIp_andNoIpIsUnknown() {
        assertThat(ClientInfo.format("10.0.0.5", null)).isEqualTo("10.0.0.5");
        assertThat(ClientInfo.format("10.0.0.5", "  ")).isEqualTo("10.0.0.5");
        assertThat(ClientInfo.format(null, "X")).isEqualTo("unknown | X");
    }

    @Test
    void ADR008_longAgent_isTrimmedToTheColumn_andLineBreaksRemoved() {
        String value = ClientInfo.format("2001:db8::1", "A".repeat(1000));
        assertThat(value).hasSize(ClientInfo.MAX_LENGTH).startsWith("2001:db8::1 | AAA");
        assertThat(ClientInfo.format("1.2.3.4", "line1\r\nline2\tx")).isEqualTo("1.2.3.4 | line1 line2 x");
    }
}
