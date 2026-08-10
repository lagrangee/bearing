# Project Catalog

## Applicability

Use for explicit `catalog inspect`, rename, unregister, relink, or confirmed reset work.

## Authority

The Project Catalog owns user-local repository discovery identity, display name, current locator,
and availability. It does not own Repository Integration Lifecycle, canonical planning, project
read-model state, repository files, or native work.

## Operation

1. Inspect the exact Catalog Entry by Entry ID or repository root. Completion: identity, current
   locator, display name, and availability are explicit.
2. For rename, change only the user-local display name. For unregister, remove only the selected
   Entry. For relink, require confirmation and replace only the locator; never move repository
   files. For reset, require confirmed empty-Catalog replacement. Completion: one exact Catalog
   effect and its consequence are accepted.
3. Run the matching Catalog command and inspect the result. Completion: the requested Catalog fact
   is current or the previous state and exact failure are reported.

## After this operation

- **Required:** A repository that needs registration runs Repository Configuration; Catalog never
  guesses or scans repositories.
- **Consider:** After relink, re-open the exact project route only after availability validates.
- **Do not infer:** Catalog success changes no repository lifecycle or planning status.

## Completion criterion

Exactly one user-authorized Catalog operation changed only discovery state, or inspection returned
current facts without mutation.
