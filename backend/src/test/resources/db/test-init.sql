-- Testcontainers init: the restricted app login role, like deploy/postgres-init does for dev.
CREATE ROLE rms_app LOGIN PASSWORD 'rms_app_test';
