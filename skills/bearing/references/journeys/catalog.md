# Project Catalog

## Applicability

Use for explicit `catalog inspect`, rename, unregister, relink, or confirmed reset work.

## Authority

The Project Catalog owns user-local repository discovery identity, display name, current locator,
and availability. It does not own Repository Integration Lifecycle, canonical planning, project
read-model state, repository files, or native work, and no Catalog effect grants Portal mutation
authority.

## Operation

1. Inspect the exact Catalog Entry by Entry ID or repository root.
2. For rename, change only the user-local display name. For unregister, remove only the selected
   Entry. For relink, require confirmation and replace only the locator; never move repository
   files. For reset, require confirmed empty-Catalog replacement.
3. Run the matching Catalog command and inspect the result. Report the current requested fact or the
   previous state and exact failure.

## After this operation

- **Required:** A repository that needs registration runs Repository Configuration; Catalog never
  guesses or scans repositories.
- **Consider:** After relink, re-open the exact project route only after availability validates.

## Completion criterion

Inspection returned current discovery facts without mutation, or one user-authorized Catalog
effect changed only discovery state without changing repository lifecycle, canonical planning,
native work, or read-model state and without granting Portal mutation authority.
