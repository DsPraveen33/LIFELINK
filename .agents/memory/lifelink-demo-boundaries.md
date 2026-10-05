---
name: LIFELINK demo boundaries
description: Project constraints for code originality, role provisioning, and routing fallback.
---

Build LIFELINK features from original code; do not clone or import ambulance-response projects.

**Why:** the user specification explicitly prohibits GitHub clones, imported ambulance projects, and copied project code.

**How to apply:** implement from the product requirements and visual reference rather than borrowing another ambulance app.

Public registration may create USER or DRIVER accounts, never OPERATOR. A development-only demo session may access the seeded operator account.

**Why:** command-center access should not be self-provisioned publicly, while the local demo still needs an accessible operator view.

**How to apply:** keep the demo-login path disabled in production and exclude OPERATOR from public registration.

Use real routing only when a provider is configured; otherwise keep deterministic simulated routes and label them as simulation data.

**Why:** the emergency demo needs repeatable routing behavior without depending on external routing availability.

**How to apply:** preserve the fallback route engine and visible simulation labeling.
