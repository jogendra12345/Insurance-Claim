# PROJECT CONTEXT MIGRATION & KNOWLEDGE TRANSFER

I am migrating this project/product from my current Claude account to a new Claude account.

This Claude environment contains the historical conversations, discussions, decisions, requirements, technical details, implementation history, corrections, preferences, and context accumulated during the development of this specific project.

The new Claude account will NOT have access to these previous conversations.

Your job is to create a **complete, self-contained Project Context Migration / Knowledge Transfer document** that preserves as much useful project knowledge as possible so that a new Claude instance can continue working on this project with essentially the same understanding that you currently have.

This is NOT a request for a simple summary.

You must reconstruct the project's **complete working context** from the entire conversation history available to you.

Think of this as a senior developer handing over an entire project to another senior developer who has never seen the project before.

The resulting document should allow the new Claude to understand:

- What this project is
- Why it exists
- What has been built
- How it works
- How it is structured
- Why important decisions were made
- What has already been tried
- What failed
- What was rejected
- What must not be changed
- What remains to be done
- What I expect from Claude
- Where development currently stands
- What should happen next

The new Claude should NOT need to repeatedly ask me to explain the project's history.

---

# CRITICAL INSTRUCTION — ANALYZE THE ENTIRE HISTORY

Analyze the **entire available conversation history for this project**, not just the latest messages.

Look for information across:

- Early discussions
- Initial requirements
- Requirement changes
- Technical discussions
- Architecture decisions
- Coding discussions
- UI/UX discussions
- Database discussions
- API discussions
- Bug fixing
- Debugging
- Refactoring
- Feature development
- Design iterations
- Corrections I gave you
- Things I rejected
- Things I explicitly asked you not to do
- Temporary solutions
- Final decisions
- Future plans
- Recent development status

Do not assume that the latest message contains all relevant information.

Older conversations may contain requirements or decisions that are still important.

At the same time, if an older decision was later changed, clearly identify the newer decision as the current/final state.

---

# VERY IMPORTANT — DO NOT INVENT INFORMATION

Only document information supported by the conversation or project files available to you.

Do NOT invent:

- Requirements
- Features
- APIs
- Database structures
- Technologies
- Architecture
- Business rules
- File names
- Code behavior
- Credentials
- Configuration
- Decisions

If something is unknown, write:

**UNKNOWN / NOT SPECIFIED**

If something is strongly inferred but not explicitly confirmed, label it:

**INFERRED**

If something was discussed but never finalized, label it:

**TENTATIVE / UNCONFIRMED**

If something was explicitly agreed upon, label it:

**CONFIRMED / AGREED**

---

# 1. PROJECT IDENTITY & OVERVIEW

Create a detailed project profile.

Include:

- Project/product name
- Project type
- Product category
- Purpose
- Problem being solved
- Target users
- Intended users/personas
- Primary use cases
- Business/domain context
- Main objectives
- Product vision
- Long-term goals
- Current development stage
- Current overall status
- Important project terminology

Explain the project as if the reader has never heard about it before.

---

# 2. PROJECT HISTORY

Reconstruct the meaningful development history.

Document:

- Original concept
- Initial requirements
- Initial architecture
- Initial implementation
- Major feature additions
- Major changes
- Architecture changes
- UI/UX changes
- Database changes
- Business-rule changes
- Technology changes
- Refactoring
- Problems discovered
- Solutions implemented
- Important corrections
- Current/final decisions

Where something evolved, show the evolution.

For example:

**Original approach → Problem → Discussion → New approach → Current decision**

Do not present obsolete decisions as current decisions.

---

# 3. COMPLETE REQUIREMENTS

Extract every meaningful requirement discussed during the project's history.

Organize requirements into:

## Functional Requirements

Everything the system must do.

## Non-Functional Requirements

Including:

- Performance
- Scalability
- Reliability
- Security
- Maintainability
- Compatibility
- Accessibility
- Availability
- Usability

## User Requirements

What users must be able to do.

## Business Requirements

Including:

- Business rules
- Workflows
- Calculations
- Pricing
- Permissions
- Validation
- Eligibility
- Restrictions
- Special cases

## Technical Requirements

Including:

- Technology requirements
- Architecture
- APIs
- Database
- Integrations
- Hosting
- Deployment
- Environment

## UI/UX Requirements

Including:

- Screens
- Pages
- Navigation
- Layout
- Components
- Forms
- Tables
- Modals
- Buttons
- Filters
- Search
- Responsive behavior
- Mobile behavior
- Desktop behavior
- Visual design
- Colors
- Typography
- Interactions

Do not omit requirements simply because they were mentioned only once.

---

# 4. COMPLETE FEATURE INVENTORY

Create a complete inventory of features.

For every feature, document:

- Feature name
- Description
- Purpose
- User flow
- Business logic
- Inputs
- Outputs
- Dependencies
- Edge cases
- Related components
- Current implementation
- Known issues
- Future improvements

Classify each feature as:

- COMPLETED
- PARTIALLY COMPLETED
- IN PROGRESS
- PLANNED
- NOT STARTED
- REMOVED
- REPLACED

---

# 5. CURRENT TECHNICAL ARCHITECTURE

Document the current architecture in detail.

Include wherever applicable:

- Frontend
- Backend
- Database
- APIs
- Authentication
- Authorization
- File storage
- External services
- Third-party integrations
- Background jobs
- Queues
- Caching
- Notifications
- Logging
- Monitoring
- Deployment
- Hosting
- CI/CD
- Environment configuration

Explain how the components communicate.

Document important data flows and request flows.

If the architecture changed during development:

1. Explain the old architecture.
2. Explain why it changed.
3. Clearly document the current architecture.

---

# 6. TECHNOLOGY STACK

Document the technology stack.

For each technology include:

- Name
- Version, if known
- Purpose
- Where it is used
- Important dependencies
- Configuration
- Reason for selection, if discussed

Include:

- Programming languages
- Frameworks
- Libraries
- Runtime
- Database
- ORM
- Authentication
- APIs
- Cloud services
- Build tools
- Package managers
- Testing frameworks
- Deployment tools
- Other important dependencies

Never guess versions.

Use **NOT SPECIFIED** when necessary.

---

# 7. CODEBASE STRUCTURE

If the actual codebase/files are available, inspect them.

Document:

- Root structure
- Main directories
- Important files
- Components
- Modules
- Services
- Controllers
- Models
- Utilities
- Database files
- Configuration files
- Scripts
- Tests

For important files/modules, explain:

- Purpose
- Responsibilities
- Important functions/classes/components
- Dependencies
- Important implementation details
- Things that should not be changed casually

Do not invent a codebase structure if you do not have access to it.

---

# 8. DATABASE & DATA MODEL

If a database exists, document the current model.

Include:

- Database technology
- Tables/collections
- Fields
- Data types, if known
- Primary keys
- Foreign keys
- Relationships
- Indexes
- Constraints
- Enums
- Important queries
- Data validation
- Business rules
- Migrations
- Seed data
- Data lifecycle

Explain important relationships and data flows.

Clearly distinguish confirmed schema from unknown information.

---

# 9. API DOCUMENTATION

Document every known API.

For each API/endpoint, include where available:

- API name
- Endpoint
- HTTP method
- Purpose
- Authentication
- Authorization
- Request parameters
- Request body
- Response
- Error response
- Validation
- Business logic
- Dependencies
- Important implementation details

Do not invent API information.

---

# 10. THIRD-PARTY SERVICES & INTEGRATIONS

Document every known integration.

For each:

- Service name
- Purpose
- Why it is used
- Integration method
- Data exchanged
- Authentication method
- Configuration
- Dependencies
- Limitations
- Known issues

NEVER include actual:

- Passwords
- API keys
- Access tokens
- Private keys
- Secrets
- Credentials

If such values are referenced, document only the variable/configuration name and say that the actual value must be obtained separately.

---

# 11. UI/UX & DESIGN SYSTEM

Document the current UI/UX in detail.

Include:

- Pages
- Screens
- Navigation
- User flows
- Components
- Forms
- Tables
- Cards
- Modals
- Buttons
- Filters
- Search
- Dashboards
- Empty states
- Loading states
- Error states
- Responsive behavior
- Mobile behavior
- Desktop behavior
- Colors
- Typography
- Spacing
- Icons
- Visual style
- Animations
- Interaction behavior

Also document UI/UX decisions that I explicitly approved.

Document UI/UX approaches that I rejected.

---

# 12. BUSINESS LOGIC

Extract all business logic from the conversations.

Document:

- Rules
- Conditions
- Calculations
- Validations
- Permissions
- User roles
- Workflows
- State transitions
- Exceptions
- Special cases
- Edge cases
- Dependencies

Write the business rules in a way that another developer can implement them without needing the original conversation.

---

# 13. IMPORTANT PROJECT DECISIONS

Create a dedicated section for important decisions.

For every major decision, document:

### Decision

What was decided.

### Context

What problem led to the decision.

### Reason

Why the decision was made.

### Alternatives

What alternatives were considered.

### Rejected Alternatives

What was rejected and why.

### Current Status

Whether the decision is:

- FINAL
- TENTATIVE
- SUPERSEDED
- UNKNOWN

### Impact

Which parts of the project depend on this decision.

Preserve the reasoning behind decisions, not just the final result.

---

# 14. MY PREFERENCES & HOW I WANT CLAUDE TO WORK

Analyze the conversations and extract my project-specific preferences.

Include preferences regarding:

- Coding style
- Architecture
- UI/UX
- Design
- Naming
- File structure
- Simplicity vs complexity
- Refactoring
- Performance
- Error handling
- Testing
- Documentation
- How features should be implemented
- How bugs should be fixed
- How Claude should explain solutions
- Things I repeatedly approved
- Things I repeatedly rejected
- Things I explicitly instructed Claude to do or not do

Only include preferences supported by actual conversation history.

---

# 15. DO NOT CHANGE / DO NOT BREAK

Create a prominent section:

# CRITICAL — DO NOT CHANGE / DO NOT BREAK

Document everything that must be preserved.

Include:

- Existing functionality
- Existing APIs
- Database behavior
- Business logic
- UI behavior
- User workflows
- Integrations
- Design decisions
- Naming conventions
- Compatibility
- Existing behavior
- Important configurations
- Anything I explicitly said not to change

Also include previous mistakes or problematic approaches that should not be repeated.

---

# 16. BUGS, ERRORS & DEBUGGING HISTORY

Document significant bugs and technical problems.

For each:

- Problem
- Symptoms
- Root cause
- Investigation
- Attempts made
- Failed approaches
- Successful approach
- Current status
- Potential future risk

This section should prevent the new Claude from repeating previous unsuccessful solutions.

---

# 17. REJECTED APPROACHES

Document important approaches that were considered but rejected.

For each:

- Proposed approach
- Why it was considered
- Why it was rejected
- Replacement approach
- Whether it could be reconsidered in the future

Do not allow the new Claude to accidentally treat rejected approaches as recommended solutions.

---

# 18. CURRENT IMPLEMENTATION STATUS

Create a detailed status report.

## Completed

Everything confirmed as complete.

## In Progress

Everything currently being developed.

## Partially Completed

Features that exist but are incomplete.

## Planned

Agreed future work.

## Not Started

Known work that has not begun.

## Known Issues

Current bugs or limitations.

## Technical Debt

Known cleanup/refactoring requirements.

## Blocked

Anything waiting for:

- Information
- Decision
- Access
- Dependency
- External service
- Other work

---

# 19. CURRENT STATE — MOST IMPORTANT SECTION

Create a section titled:

# CURRENT STATE — READ THIS FIRST

This must describe the project **as it exists at the end of our current conversation history**.

Include:

- Current project purpose
- Current architecture
- Current technology stack
- Current features
- Current UI
- Current database
- Current APIs
- Current integrations
- Current implementation status
- Current bugs
- Current limitations
- Current blockers
- Current priorities
- What was most recently being worked on
- What should be done next

This section must represent the latest known state.

---

# 20. NEXT STEPS & ROADMAP

Extract future work from the conversation.

Organize it into:

## Immediate Next Steps

Things that should happen next.

## Short-Term

Things that should follow.

## Long-Term

Future improvements.

For each item include dependencies/prerequisites where known.

---

# 21. OPEN QUESTIONS & UNRESOLVED ITEMS

List everything that remains unresolved.

For each:

- Question
- Context
- Why it matters
- Options discussed
- Current status
- What information is needed from me

Do not silently make decisions for unresolved issues.

---

# 22. TESTING & QUALITY ASSURANCE

Document:

- Testing strategy
- Testing framework
- Existing tests
- Important test cases
- Manual testing
- Edge cases
- Expected behavior
- Known failing tests
- Regression concerns
- Bugs discovered through testing

---

# 23. SECURITY

Document relevant security considerations.

Include:

- Authentication
- Authorization
- Roles
- Permissions
- Sensitive data
- Input validation
- API security
- Data protection
- Secret management
- Security decisions
- Known risks

NEVER include actual credentials or secret values.

---

# 24. DEVELOPMENT ENVIRONMENT & SETUP

Document everything known about setting up and running the project.

Include:

- Operating system requirements
- Runtime
- Versions
- Package manager
- Installation
- Dependencies
- Environment variables
- Configuration
- Development commands
- Build commands
- Test commands
- Run commands
- Deployment commands
- Required external services

For secrets, only document the variable name and state:

**VALUE MUST BE PROVIDED SEPARATELY**

---

# 25. PROJECT TERMINOLOGY / GLOSSARY

Create a glossary.

For every project-specific term:

**Term:**  
**Meaning:**  
**How it is used in this project:**

Include:

- Abbreviations
- Domain terms
- Internal terminology
- Technical terminology
- Product terminology

---

# 26. IMPORTANT CONTEXT THAT COULD OTHERWISE BE LOST

Look specifically for information that would disappear if the original conversation disappeared.

Capture:

- Small but important decisions
- Requirements mentioned only once
- Corrections I made
- Things I explicitly liked
- Things I explicitly disliked
- Temporary workarounds
- Important assumptions
- Special edge cases
- Historical context
- Warnings
- Failed experiments
- Important implementation details
- Important reasoning
- Important preferences
- Anything that may affect future development

Do not ignore information merely because it appears minor.

---

# 27. INSTRUCTIONS FOR THE NEW CLAUDE

Create a section called:

# INSTRUCTIONS FOR THE NEW CLAUDE

Write direct instructions for the Claude instance that will receive this file.

Tell the new Claude to:

1. Read and understand this document before making major changes.
2. Treat confirmed information as established project context.
3. Preserve existing functionality.
4. Follow the established architecture.
5. Respect final decisions.
6. Avoid unnecessary rewrites.
7. Avoid unnecessary refactoring.
8. Check existing implementation before creating new code.
9. Do not repeat previously rejected approaches without a valid reason.
10. Do not assume missing information.
11. Ask for clarification when an unresolved decision materially affects implementation.
12. Clearly distinguish existing requirements from new recommendations.
13. Preserve established business logic.
14. Maintain consistency with the existing codebase.
15. Protect functionality that is marked "DO NOT CHANGE / DO NOT BREAK".
16. Consider debugging history before attempting previously encountered problems.
17. Update the project context when major decisions or architecture changes occur.

Add any additional project-specific instructions supported by the conversation.

---

# 28. INFORMATION CONFIDENCE

Where useful, classify important information using:

**CONFIRMED**  
Explicitly stated, agreed upon, or verified.

**IMPLEMENTED**  
Known to exist in the implementation/code.

**AGREED**  
Explicitly accepted as a project decision.

**INFERRED**  
Strongly inferred from the available context.

**TENTATIVE**  
Discussed but not finalized.

**ASSUMED**  
An assumption that may need confirmation.

**UNKNOWN**  
Insufficient information.

Do not present assumptions as confirmed requirements.

---

# 29. FINAL HANDOVER SUMMARY

At the end of the document, provide a concise but complete summary containing:

- What the project is
- What it solves
- Who it is for
- What has been built
- Current architecture
- Current technology stack
- Current status
- Most important decisions
- Most important constraints
- Important bugs/issues
- Immediate next steps
- Long-term direction
- Critical things the new Claude must remember

---

# FINAL COMPLETENESS CHECK

Before creating the final file, perform a complete review of the conversation history.

Ask yourself:

1. Did I analyze the entire project history?
2. Did I capture both old and recent requirements?
3. Did I identify changes to requirements?
4. Did I distinguish old decisions from current decisions?
5. Did I capture important corrections I received?
6. Did I capture things that were explicitly rejected?
7. Did I capture bugs and debugging history?
8. Did I capture failed approaches?
9. Did I capture business logic?
10. Did I capture technical architecture?
11. Did I capture database information?
12. Did I capture APIs?
13. Did I capture integrations?
14. Did I capture UI/UX decisions?
15. Did I capture development preferences?
16. Did I capture things that must not be changed?
17. Did I capture the current implementation status?
18. Did I capture future plans?
19. Did I capture unresolved questions?
20. Did I avoid inventing information?
21. Did I avoid including secrets?
22. Could a completely new Claude understand the project without seeing this original conversation?
23. Could the new Claude realistically continue development using this document as its primary historical context?

If anything important is missing, add it before generating the final document.

---

# MANDATORY OUTPUT REQUIREMENT — ACTUAL .MD FILE

This requirement is extremely important.

The final deliverable MUST be an **actual Markdown `.md` file**.

Do NOT simply paste the Markdown document into the chat.

Do NOT return only a Markdown code block.

You must **create/generate the actual `.md` file**.

Use this filename:

`[PROJECT_NAME]_CLAUDE_CONTEXT_MIGRATION.md`

Replace `[PROJECT_NAME]` with the actual project/product name.

The generated `.md` file must contain the **complete document**, including every relevant section above.

The `.md` file itself is the primary deliverable.

I will download this file and upload it to another Claude account.

Before giving me the file:

1. Generate the complete content.
2. Save it as an actual `.md` file.
3. Verify that the file exists.
4. Verify that the content is complete.
5. Ensure no important sections are missing.
6. Ensure Markdown formatting is valid.
7. Ensure the document is readable.
8. Ensure no passwords, API keys, tokens, private keys, or other secrets are included.
9. Ensure the file is not merely a short summary.
10. Ensure the document represents the complete project knowledge available from our conversation history.

The final `.md` file should effectively function as:

**"The complete memory, context, history, requirements, technical knowledge, decisions, constraints, and development instructions for this project that another Claude needs in order to take over development."**

## MOST IMPORTANT OBJECTIVE

You are not creating a conversation summary.

You are creating a **PROJECT KNOWLEDGE TRANSFER PACKAGE**.

The new Claude should be able to read this `.md` file and understand the project with as much useful context as possible, despite having no access to this original Claude account or its previous conversations.

Prioritize:

**Completeness > brevity**

**Accuracy > assumptions**

**Current state > obsolete state**

**Preserving decisions and reasoning > simple summarization**

**Useful development context > conversational history**

Finally, provide me with the **actual generated `.md` file** as the deliverable.
