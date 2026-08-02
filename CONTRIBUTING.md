# Contributing to MiniStr

Issue reports and pull requests are welcome.

## Before opening a pull request

1. Start from the latest `main` and keep each pull request focused.
2. Run `npm ci`, `npm run typecheck:test`, `npm test`, and `npm run build`.
3. Do not include API keys, tokens, passwords, private keys, local `.env` files, personal data, or links to private coding sessions in commits, commit messages, issue comments, or pull-request descriptions.
4. Run `npm run check:links` to confirm no commit message links to a private coding session. Some tools add such a link automatically, so check even when you did not write one by hand. Reword an offending message with `git commit --amend`, or with `git rebase -i` for older commits.
5. Explain the user-visible change and the checks you ran.

## CI for forks

Pull requests from forks run the same type-check, test, and build workflow as branches in this repository. The workflow uses GitHub's `pull_request` event with read-only `contents` permission and does not receive repository secrets. GitHub Pages deployment runs only after a push to `main`, not from pull requests.

CI also scans the commit messages a pull request adds and fails when one links to a private coding session, so the rule above is enforced rather than only documented.

## Reporting a security issue

Please do not open a public issue for a suspected secret or private-session disclosure. Contact the repository owner privately with the affected URL or commit reference, without reposting the sensitive value.
