package com.santhula.rms.auth.service;

import com.santhula.rms.common.error.ApiException;
import java.util.Locale;

/** Rules beyond the 8-72 length the spec already enforces. */
final class PasswordRules {

    private PasswordRules() {
    }

    static void check(String username, String password, String field) {
        if (password != null && username != null
                && password.trim().toLowerCase(Locale.ROOT).equals(username.trim().toLowerCase(Locale.ROOT))) {
            throw ApiException.validation(field, "Password must not be the same as the username");
        }
    }
}
