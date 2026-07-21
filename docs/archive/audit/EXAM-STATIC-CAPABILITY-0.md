# EXAM-STATIC-CAPABILITY-0: Static Analysis Capability Inventory

**Date:** 2025-07-09  
**Phase:** Phase 0B  
**Purpose:** Inventory supported local static analysis mechanisms for the TypeScript exam platform repository.

## Executive Summary

The exam platform repository has a comprehensive custom static analysis infrastructure with **no CodeQL availability** and **no ESLint configuration**. The project relies primarily on custom Node.js lint scripts, TypeScript strict mode, Prettier, and the custom architecture linting system. Semgrep is available and capable but currently unused.

## Repository Characteristics

- **TypeScript Files:** 891 files (.ts/.tsx)
- **Lines of Code:** ~143,070 lines
- **Packages:** 10 packages (apps + packages monorepo)
- **Test Files:** 442 test files
- **Repository:** Private GitHub repo (git@github.com:jnhu76/exam.git)
- **Language:** TypeScript + React + Node.js
- **Package Manager:** pnpm 11.1.2
- **Node Version:** v24.15.0

## 1. Semgrep Usability and Configuration

### Availability: ✅ AVAILABLE
- **Version:** 1.168.0
- **Installation:** Globally available in environment
- **Status:** Installed and functional

### Configuration: ❌ NO CONFIGURATION EXISTS
- No `semgrep.yml` configuration files found
- No `.semgrepignore` file found
- No Semgrep rules in repository
- No Semgrep integration in package.json scripts

### Capability Assessment
- **Languages Supported:** Full TypeScript/JavaScript support (typescript, javascript, tsx, jsx)
- **SARIF Output:** ✅ Native SARIF format support via `--sarif` flag
- **Pattern Matching:** ✅ Full support for TypeScript patterns
- **Registry Access:** ⚠️ Requires metrics enabled for `--config auto`
- **OSS Mode:** ✅ Can run with `--oss-only --metrics off` for offline/privacy

### Sample Successful Execution
```bash
semgrep scan --config /tmp/test-sarif-semgrep.yaml --sarif --no-error --metrics off apps/web/src/lib
```
Result: Successfully scanned 33 files with valid SARIF JSON output.

### Integration Requirements
To integrate Semgrep:
1. Create `semgrep.yml` configuration with TypeScript-specific rules
2. Add script to `package.json`: `"semgrep": "semgrep scan --config semgrep.yml --sarif"`
3. Configure `.semgrepignore` for node_modules, dist, coverage
4. Consider custom rules for architecture violations currently caught by custom scripts

### Current Custom Scripts That Could Be Replaced/Enhanced
- `check-architecture.mjs` - architecture boundary violations
- `check-code-quality.mjs` - console.log detection
- `check-hardcoded-copy.mjs` - deployment-specific terms
- `check-db-config.mjs` - DB configuration regression guards

## 2. CodeQL Availability and Licensing Constraints

### Availability: ❌ NOT AVAILABLE
- **Command Status:** `codeql: NOT FOUND (command not found)`
- **Installation:** Not installed in environment
- **GitHub Actions:** No CodeQL workflow present

### Licensing Constraints for Private Repository
- **GitHub Free/Private Repo Limitations:** 
  - CodeQL Advanced Security features require GitHub Enterprise
  - Private repos on free GitHub plans have limited CodeQL access
  - Current repo is private (git@github.com:jnhu76/exam.git)
  - No evidence of Enterprise license
  - ❌ **Cannot assume CodeQL is legally usable**

### Operational Constraints
- **No Local Installation:** Would require manual installation
- **Private Repo Restrictions:** Free tier limits for private repos
- **License Compliance:** Cannot bypass licensing restrictions
- **Conclusion:** CodeQL should NOT be assumed available or usable

### Alternative Considerations
- **Semgrep OSS:** Free, open-source alternative
- **Custom Scripts:** Existing custom lint infrastructure
- **TypeScript Compiler:** Built-in strict type checking

## 3. SARIF-Producing Analysis Paths

### Available SARIF Production

#### Semgrep (Ready to Use)
```bash
semgrep scan --config semgrep.yml --sarif --output results.sarif
```
- ✅ Valid SARIF v2.1.0 format
- ✅ Full TypeScript support
- ✅ Local execution without external services
- ✅ Works offline with metrics disabled

#### Custom Script Conversions (Potential)
The following custom scripts could be enhanced to produce SARIF:

**check-architecture.mjs** - Architecture violations
- Currently: Exit code 1 + text output
- SARIF Opportunity: Convert to SARIF for architecture rule violations
- Priority: High - critical architecture boundaries

**check-hardcoded-copy.mjs** - Deployment-specific terms
- Currently: Exit code 1 + detailed error messages
- SARIF Opportunity: Generate SARIF for hardcoded business copy
- Priority: Medium - business logic validation

**check-code-quality.mjs** - Code quality issues
- Currently: Console output + exit code
- SARIF Opportunity: Generate SARIF for console.log violations
- Priority: Medium - code style enforcement

**check-db-config.mjs** - Configuration regressions
- Currently: Exit code 1 + violation descriptions
- SARIF Opportunity: Generate SARIF for configuration issues
- Priority: High - database configuration safety

#### No Other SARIF Sources Found
- No ESLint configuration (no SARIF plugin available)
- No CodeQL integration
- No other static analysis tools with SARIF output

### SARIF Integration Pathways

#### Immediate Capability
1. **Semgrep Rules:** Can start immediately with `--sarif` output
2. **Custom Script Enhancement:** Convert existing scripts to SARIF format
3. **CI Integration:** Add SARIF upload to GitHub Actions workflow

#### Development Required
1. **SARIF Conversion Library:** Helper functions to convert script output to SARIF
2. **Rule ID Mapping:** Map custom script violations to SARIF rule IDs
3. **Severity Classification:** Standardize severity levels across tools

## 4. TypeScript/ESLint Static Analysis Mechanisms

### TypeScript Configuration: ✅ COMPREHENSIVE STRICT MODE

**Compiler Options (tsconfig.base.json):**
```json
{
  "strict": true,
  "noImplicitAny": true,
  "strictNullChecks": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "noFallthroughCasesInSwitch": true,
  "noImplicitReturns": true,
  "esModuleInterop": true,
  "skipLibCheck": true,
  "forceConsistentCasingInFileNames": true,
  "resolveJsonModule": true,
  "isolatedModules": true,
  "moduleDetection": "force",
  "module": "ESNext",
  "moduleResolution": "bundler",
  "target": "ES2022",
  "lib": ["ES2022"],
  "declaration": true,
  "declarationMap": true,
  "sourceMap": true
}
```

**Type Safety Coverage:**
- ✅ Comprehensive strict mode enforcement
- ✅ Null safety guarantees
- ✅ No implicit `any` types allowed
- ✅ Exact optional properties
- ✅ Exhaustive switch checks
- ✅ Implicit return checks

### ESLint Configuration: ❌ NOT CONFIGURED

**Status:**
- No `.eslintrc.json` found
- No `eslint.config.*` found
- No ESLint plugins installed in packages
- No ESLint integration in CI workflow

**Documented Requirements (docs/code-quality.md):**
The code-quality.md documentation specifies ESLint rules that should be enabled:
```
@typescript-eslint/no-explicit-any          — 禁止 any
@typescript-eslint/no-floating-promises     — 禁止未 await 的 Promise
@typescript-eslint/consistent-type-imports  — 统一 type import
@typescript-eslint/no-unused-vars           — 清理未使用变量
@typescript-eslint/switch-exhaustiveness-check — switch 穷尽检查
import/no-cycle                             — 禁止循环依赖
no-console                                  — 禁止 console.log
```

**Gap Analysis:**
- ⚠️ **Requirement vs Reality:** Documentation specifies ESLint rules but not configured
- ⚠️ **Missing Infrastructure:** No ESLint setup despite documented requirements
- ❌ **No SARIF Production:** Without ESLint, cannot use ESLint SARIF formatters

### Test Infrastructure

**Testing Framework:** Vitest
- **Test Configuration:** per-package vitest.config.ts files
- **Test Files:** 442 test files (.test.ts, .spec.ts)
- **Coverage:** Vitest coverage v8 with thresholds (lines: 60%, branches: 50%, functions: 50%)
- **Parallelism:** Configurable per-worker database isolation for parallel test execution

## 5. Other Static Analysis Mechanisms

### Custom Node.js Scripts: ✅ ROBUST SYSTEM

**Architecture Linting (check-architecture.mjs):**
- ✅ Package dependency boundary enforcement
- ✅ Domain package leaf enforcement (no fastify/React/Drizzle)
- ✅ AuthZ package leaf enforcement
- ✅ Contracts cannot depend on fastify
- ✅ Exam-engine cannot depend on fastify
- ✅ Routes must use repositories (no bare db.select)
- ✅ Routes must not import drizzle-orm directly
- ✅ Routes must not import DB schema directly

**Code Quality (check-code-quality.mjs):**
- ✅ Console output detection (console.log, console.error)
- ✅ Coverage across apps and packages
- ✅ Excludes test files and dist directories

**Hardcoded Copy Guard (check-hardcoded-copy.mjs):**
- ✅ Two-tier hardcoded copy detection
- ✅ Deployment-specific terms forbidden (校内/校园/大学/etc.)
- ✅ CJK detection in production source
- ✅ Allowlist mechanism for documented exceptions
- ✅ CSV/template compatibility handling

**DB Configuration Regression Guards (check-db-config.mjs):**
- ✅ Single DB URL resolver declaration site
- ✅ No hardcoded localhost defaults outside databaseUrl.ts
- ✅ Vitest configs use TEST_RUNTIME_ENV constant
- ✅ Configuration drift prevention

**Additional Scripts:**
- ✅ `check-docstring-coverage.mjs` - JSDoc coverage analysis
- ✅ `check-e2e-artifacts.mjs` - E2E test artifact validation
- ✅ `check-frontend-primitives.mjs` - Frontend primitive checks
- ✅ `check-test-env-contract.mjs` - Test environment contract validation
- ✅ `check-test-time-contract.mjs` - Test timing contract validation

### Prettier: ✅ CONFIGURED
- **Version:** 3.8.3
- **Usage:** Formatter for code style
- **Integration:** `pnpm format:check` script
- **Pre-commit:** Husky + lint-staged integration

### Husky Git Hooks: ✅ CONFIGURED
- **Usage:** Pre-commit hooks for code quality
- **Integration:** lint-staged for Prettier
- **Preparation:** `pnpm prepare` command

### TypeScript Compiler: ✅ ACTIVELY USED
- **Version:** 5.9.3 (workspace)
- **Strict Mode:** Comprehensive strict options
- **Integration:** `pnpm typecheck` via Turbo
- **Compilation:** ESM modules, isolated modules

### Turbo Monorepo Runner: ✅ INFRASTRUCTURE
- **Version:** 2.9.16
- **Purpose:** Monorepo build and test orchestration
- **Caching:** Remote caching with TURBO_TOKEN
- **Parallel Execution:** Efficient parallel builds and tests

## 6. CI/CD Integration

### GitHub Actions Workflow: ✅ CONFIGURED

**Static Checks Job (.github/workflows/ci.yml):**
```yaml
static:
  name: Static checks
  runs-on: ubuntu-latest
  timeout-minutes: 10
  steps:
    - Checkout
    - Install pnpm
    - Setup Node.js 24.15.x
    - Install dependencies
    - Run: pnpm verify:static
```

**verify:static Script:**
```bash
pnpm format:check && pnpm lint && pnpm lint:copy && pnpm lint:arch && pnpm lint:db-config && pnpm typecheck && pnpm --filter @exam/api api:openapi:check
```

**Coverage:** 
- ❌ No SARIF upload currently configured
- ❌ No CodeQL scanning configured
- ❌ No Semgrep integration in CI

## 7. Recommendations and Next Steps

### Immediate Opportunities

#### 1. Semgrep Integration (High Priority)
- ✅ Ready to use with minimal configuration
- ✅ Native SARIF output support
- ✅ TypeScript rule sets available
- ✅ Can replace/enhance custom scripts

**Recommended Approach:**
1. Create `semgrep.yml` with TypeScript-specific rules
2. Add security, best practices, and TypeScript rules
3. Add SARIF output configuration
4. Integrate into CI workflow
5. Gradually migrate custom scripts to Semgrep rules

#### 2. Custom Script SARIF Enhancement (Medium Priority)
**Priority Scripts:**
1. `check-architecture.mjs` - Critical architecture boundaries
2. `check-db-config.mjs` - Database configuration safety
3. `check-hardcoded-copy.mjs` - Business logic validation
4. `check-code-quality.mjs` - Code style enforcement

**Implementation:**
1. Create SARIF conversion helper library
2. Map existing violation patterns to SARIF format
3. Add `--sarif` option to custom scripts
4. Integrate SARIF upload into CI

#### 3. ESLint Configuration (Low Priority)
**Gap:** Documented requirements vs reality mismatch
**Decision:** Evaluate if ESLint is needed given:
- ✅ Comprehensive TypeScript strict mode
- ✅ Robust custom script infrastructure
- ✅ Prettier for formatting
- ❌ No ESLint configuration currently

**Considerations:**
- May be redundant with current custom scripts
- TypeScript strict mode covers most type safety
- Custom scripts cover business-specific rules

### Long-term Considerations

#### CodeQL Evaluation (Not Recommended)
- ❌ Not available in current environment
- ❌ Licensing constraints for private repos
- ❌ Requires Enterprise license for advanced features
- ✅ Semgrep provides similar capabilities with fewer restrictions

#### SARIF Infrastructure Development
1. Create unified SARIF processing pipeline
2. Standardize rule IDs and severity levels
3. Implement SARIF merge and deduplication
4. Add SARIF upload to GitHub Actions
5. Consider SARIF visualization tools

## 8. Tool Availability Summary

| Tool | Available | Configured | SARIF Capable | Ready for Use |
|------|-----------|------------|---------------|---------------|
| **Semgrep** | ✅ Yes | ❌ No | ✅ Yes | ✅ Yes |
| **CodeQL** | ❌ No | ❌ No | ✅ Yes | ❌ No (licensing) |
| **TypeScript** | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes |
| **ESLint** | ❌ No | ❌ No | ✅ Yes | ❌ No |
| **Custom Scripts** | ✅ Yes | ✅ Yes | ⚠️ Potential | ✅ Yes |
| **Prettier** | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes |
| **Vitest** | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes |

## 9. Production Readiness Assessment

### Current Static Analysis Posture: ✅ STRONG
- **Type Safety:** Comprehensive strict mode TypeScript
- **Architecture:** Robust custom architecture linting
- **Code Quality:** Multi-layered custom script checks
- **Business Logic:** Hardcoded copy guard
- **Database Safety:** Configuration regression guards

### SARIF Production Readiness: ⚠️ PARTIAL
- **Semgrep:** Ready with configuration
- **Custom Scripts:** Require SARIF enhancement
- **Integration:** CI workflow in place, needs SARIF upload
- **Visualization:** No SARIF processing pipeline

### Security Analysis Readiness: ⚠️ PARTIAL
- **Static Security:** No dedicated security static analysis
- **Semgrep Security:** Available but not configured
- **Dependency Scanning:** Not evident in current setup
- **Secret Detection:** Not configured

## 10. Constraints and Limitations

### Technical Constraints
- **No ESLint:** Despite documented requirements
- **No CodeQL:** Not available and licensing restrictions
- **Private Repository:** Limits GitHub Advanced Security features
- **Custom Script Maintenance:** Requires ongoing maintenance

### Operational Constraints
- **Semgrep Registry:** Requires metrics for `--config auto`
- **SARIF Processing:** No unified SARIF infrastructure
- **Security Analysis:** No dedicated security scanning
- **Dependency Analysis:** Limited dependency scanning

### Licensing Constraints
- **CodeQL:** Cannot assume legal use for private repos
- **Semgrep:** OSS version available, Pro requires license
- **GitHub Actions:** Standard features only (no Enterprise)

## Conclusion

The exam platform repository has a **strong custom static analysis foundation** with comprehensive TypeScript strict mode and robust custom Node.js lint scripts. **Semgrep is available and ready for immediate integration** with native SARIF output. **CodeQL is not available and cannot be assumed usable** due to licensing constraints for private repositories.

The primary opportunities are:
1. **Integrate Semgrep** with TypeScript and security rules
2. **Enhance custom scripts** to produce SARIF output
3. **Develop SARIF infrastructure** for unified analysis processing
4. **Consider ESLint** evaluation given current custom script coverage

The repository is **well-positioned** for enhanced static analysis without requiring CodeQL or significant infrastructure changes.