# Code Patterns & Principles

> See also [CONTRIBUTING.md](CONTRIBUTING.md).

This document outlines the coding patterns and principles we follow in this codebase. These patterns help maintain consistency, testability, and maintainability.

## API Design Patterns

### 1. Pass Domain Objects, Not Primitives

**Prefer passing domain objects over extracting individual fields at call sites.**

```typescript
// Good: Pass the domain object
function computePath(doc: GranolaDoc): string {
  const title = getTitleOrDefault(doc);
  const date = getNoteDate(doc);
  // ...
}

// Avoid: Requiring callers to extract fields
function computePath(title: string, date: Date): string {
  // ...
}
```

**Rationale:** Centralizes data extraction logic, reduces parameter passing, and makes APIs more domain-focused. Changes to how we extract data only need to happen in one place.

### 2. Single Source of Truth for Configuration

**Extract configuration logic into dedicated getter methods that encapsulate conditional logic.**

```typescript
// Good: Single method encapsulates pattern selection logic
getNoteFilenamePattern(): string {
  return this.settings.filenamePattern;
}

computeTranscriptFilenamePattern(): string {
  if (this.settings.transcriptHandling === "same-location") {
    return this.settings.filenamePattern + "-transcript";
  }
  // ... other conditions
}
```

**Rationale:** Makes configuration logic easier to test, maintain, and modify. All pattern selection logic lives in one place.

### 3. Encapsulate Implementation Details

**Functions should handle their own data extraction and formatting concerns internally.**

```typescript
// Good: Function handles its own concerns
function resolveFilenamePattern(doc: GranolaDoc, pattern: string): string {
  const title = getTitleOrDefault(doc);
  const date = getNoteDate(doc);
  // ... resolve pattern and add .md extension
  return sanitizeFilename(resolved) + ".md";
}

// Avoid: Requiring callers to handle formatting
function resolveFilenamePattern(pattern: string, title: string, date: Date): string {
  // Caller must extract title/date and add .md extension
}
```

**Rationale:** Reduces coupling and makes code easier to use correctly. Callers don't need to know about data extraction or formatting details.

## Testing Patterns

### 4. Focused Mocking Strategy

**Mock only dependencies with side effects, time-dependency, or that are slow/expensive. Use real instances when possible.**

```typescript
// Good: Mock only what needs mocking
jest.mock("../../src/services/prosemirrorMarkdown");
jest.mock("../../src/utils/dateUtils", () => {
  const actual = jest.requireActual("../../src/utils/dateUtils");
  return { ...actual, getNoteDate: jest.fn() };
});

// Use real PathResolver instance, spy on methods when needed
const pathResolver = new PathResolver(settings);
jest.spyOn(pathResolver, "getNoteFilenamePattern").mockReturnValue("{title}");
```

**Rationale:** Tests are more maintainable and give better confidence. Real dependencies catch integration issues; mocks isolate the unit under test.

### 5. Explain Mocking Decisions

**Add inline comments explaining why something is mocked.**

```typescript
// Mock convertProsemirrorToMarkdown: While this is a pure function, we mock it to
// isolate DocumentProcessor's logic (frontmatter generation, formatting) from
// the ProseMirror conversion logic, making tests more maintainable and focused.

// Mock getNoteDate: This function has time-dependent behavior (returns new Date()
// as fallback), so we mock it to ensure consistent, deterministic test results
// and avoid brittleness from time-dependent test failures.
```

**Rationale:** Helps future maintainers understand the testing strategy and makes it easier to decide when to add or remove mocks.

### 6. Prefer Direct Mocking Over Test Infrastructure

**Mock time-dependent functions directly rather than using fake timers when possible.**

```typescript
// Good: Mock the function directly
jest.mock("../../src/utils/dateUtils", () => ({
  getNoteDate: jest.fn().mockReturnValue(new Date("2024-01-15")),
}));

// Avoid: Using fake timers for simple cases
jest.useFakeTimers();
jest.setSystemTime(new Date("2024-01-15"));
```

**Rationale:** Simpler tests are easier to understand and maintain. Only use fake timers when you need to test actual time-dependent behavior.

## General Principles

- **Minimize coupling:** Functions should depend on abstractions, not implementation details
- **Single responsibility:** Each function/class should have one clear purpose
- **Testability first:** Design APIs that are easy to test in isolation
- **Document decisions:** Use comments to explain "why," not just "what"

