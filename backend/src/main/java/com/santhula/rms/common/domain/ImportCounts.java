package com.santhula.rms.common.domain;

/** What an import created, updated or found already equal. */
public record ImportCounts(int created, int updated, int unchanged) {

    public static final ImportCounts NONE = new ImportCounts(0, 0, 0);

    public ImportCounts addCreated() {
        return new ImportCounts(created + 1, updated, unchanged);
    }

    public ImportCounts addUpdated() {
        return new ImportCounts(created, updated + 1, unchanged);
    }

    public ImportCounts addUnchanged() {
        return new ImportCounts(created, updated, unchanged + 1);
    }
}
