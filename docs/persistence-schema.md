# Persistence schema policy

Game saves, replay files, and campaign progress include a `schemaVersion` and
enforce their existing size limits before parsing. Each format accepts only the
current version and explicitly listed adjacent migration steps. Version 1 is
migrated to version 2 before strict structural and replay-consistency
validation.

Migrations are pure: they do not write, delete, or repair malformed content.
Unknown and future versions are rejected. Invalid local saves remain available
for the player to delete explicitly; replay imports are simply rejected.
Whenever a schema changes, add one named `vNToV(N+1)` migration and a fixture
test for each supported historical version.
