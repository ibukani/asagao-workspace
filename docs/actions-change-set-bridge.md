# Actions Change Set Bridge

Actions Change Set Bridge is a temporary bridge for applying ChatGPT-generated change sets before the Asagao Workspace Runner has its own interactive apply / verify / PR flow.

It is not a replacement for the Workspace Runner. It exists to move a prepared patch through GitHub Actions, run repository verification, and create or update a pull request.

## Change set layout

Create a branch named `changes/<change-id>` with these files:

```text
changes/<change-id>/change.patch
changes/<change-id>/metadata.json
```

`change.patch` must be a repository-root relative git patch that can be applied with `git apply`.

`metadata.json` is optional. The workflow prints it for review when present. A minimal example is:

```json
{
  "changeId": "issue-36",
  "title": "Implement runner shared library adapters",
  "issue": 36,
  "baseBranch": "main",
  "outputBranch": "feat/runner-shared-library-adapters"
}
```

## Manual run

Run `.github/workflows/apply-change-set.yml` with:

```text
change_id: issue-36
base_branch: main
output_branch: feat/runner-shared-library-adapters
create_pr: true
run_verify: true
```

The workflow reads `changes/issue-36/change.patch` from branch `changes/issue-36`, checks the patch, applies it, runs verification, pushes the output branch, and creates or updates a pull request.

## Safety boundaries

- The workflow is limited to manual dispatch.
- The job is guarded to the repository owner actor.
- The workflow does not accept arbitrary commands.
- The patch is checked with `git apply --check` before it is applied.
- Verification uses the repository's standard `npm install` and `npm run verify` commands.
- The token permissions are limited to `contents: write` and `pull-requests: write` because the job must push a branch and create or update a pull request.

## Relationship to Asagao Workspace

This bridge maps to the future Workspace Runner flow as follows:

```text
prepare_change_set -> metadata.json
export_patch       -> change.patch
run_command        -> npm run verify in Actions
commit_and_push    -> output branch push
create_pull_request -> gh pr create / gh pr edit
```

Once Asagao Workspace has first-class change set export, command execution, and PR output, this bridge should become a fallback path rather than the primary implementation path.
