# Security

## Reporting a problem

Please don't open a public issue for security problems. Open this project's [Security tab](https://github.com/SelcukOzbilgi/trick-or-trap/security) on GitHub and click **Report a vulnerability**. Only I can see what you send. That is the only reporting channel; there is no security email address.

## What is in scope

- The Trick or Trap web app, once it is deployed.
- This repository: the code, the GitHub workflows, and the Kiro agent and steering files under `.kiro/`.

The app opens URLs that visitors type in, using a remote browser. Reports about making it reach places it shouldn't (internal or private addresses, cloud metadata endpoints, `file:` and similar schemes, redirect tricks, DNS rebinding and other SSRF-type problems) are especially welcome.

Out of scope: the dark patterns in the Boo-tique demo shop, which are there on purpose, and problems in third-party sites the scanner visits.

## What to expect

I'll reply as soon as I can, tell you whether I can reproduce the problem, and keep you posted until it is fixed. This is a small hackathon project, so there is no bug bounty. If you'd like, I'll credit you when the fix lands.
