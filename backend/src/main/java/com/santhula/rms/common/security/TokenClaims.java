package com.santhula.rms.common.security;

/** Claim names in the RMS access token (JWT, HS256). `sub` is the user id. */
public final class TokenClaims {

    public static final String USERNAME = "uname";
    public static final String FULL_NAME = "name";
    public static final String TERMINAL_ID = "tid";
    public static final String TERMINAL_NAME = "tname";
    public static final String TERMINAL_TYPE = "ttype";
    public static final String PERMISSIONS = "perms";
    public static final String BRANCH_ID = "branch";
    /** Session id: one login and its chain of refresh tokens (BUG-1-003). */
    public static final String SESSION_ID = "sid";

    /** Header every registered device sends (conventions.md, ADR-006). */
    public static final String TERMINAL_HEADER = "X-Terminal-Id";

    private TokenClaims() {
    }
}
