package com.santhula.rms.settings.domain;

/** Order types with their own service charge rate. Credit orders use their service mode's rate. */
public enum ServiceChargeOrderType {
    DINE_IN,
    TAKEAWAY,
    DELIVERY
}
