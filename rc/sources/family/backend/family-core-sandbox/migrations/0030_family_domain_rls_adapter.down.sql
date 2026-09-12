BEGIN;

REVOKE ALL ON domain.compass_results, domain.journeys, domain.timeline_events,
  domain.blueprints, domain.adapter_traces FROM phoenix_core_app;
REVOKE USAGE ON SCHEMA domain FROM phoenix_core_app;
DROP FUNCTION IF EXISTS domain.ingest_education_synthetic(
  text, text, text, uuid, uuid, text, uuid, uuid, uuid, uuid, uuid, uuid
) CASCADE;
DROP FUNCTION IF EXISTS core.has_active_entitlement(text, uuid, text) CASCADE;
DROP TRIGGER IF EXISTS adapter_traces_append_only ON domain.adapter_traces;
DROP TRIGGER IF EXISTS timeline_events_append_only ON domain.timeline_events;
DROP TABLE IF EXISTS domain.adapter_traces CASCADE;
DROP TABLE IF EXISTS domain.blueprints CASCADE;
DROP TABLE IF EXISTS domain.timeline_events CASCADE;
DROP TABLE IF EXISTS domain.journeys CASCADE;
DROP TABLE IF EXISTS domain.compass_results CASCADE;

COMMIT;
