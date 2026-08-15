/**
 * Architecture guards.
 *
 * These rules are the mechanism that keeps the architecture in docs/06 true over time.
 * Conventions decay; CI failures do not. Every rule here corresponds to a documented
 * decision, and the `comment` field says which one — so a developer who hits a failure
 * can read WHY rather than just deleting the rule.
 *
 * Run: pnpm arch
 */
module.exports = {
  forbidden: [
    // ---------------------------------------------------------------------
    // THE dependency rule. docs/06 §1.
    // The domain layer models the business. It must not know that Prisma,
    // Fastify, or Redis exist — that is what makes it testable in milliseconds
    // and replaceable without touching business rules.
    // ---------------------------------------------------------------------
    {
      name: 'domain-is-pure',
      severity: 'error',
      comment:
        'A domain layer may not import infrastructure, interface, or any I/O library. ' +
        'If you need I/O, define a port in domain/ports and implement it in infrastructure/. ' +
        'See docs/06 §1 and §4.3.',
      from: { path: '(^|/)domain/' },
      to: {
        path: [
          '(^|/)infrastructure/',
          '(^|/)interface/',
          'node_modules/@prisma/client',
          'node_modules/prisma',
          'node_modules/fastify',
          'node_modules/ioredis',
          'node_modules/bullmq',
          'node_modules/axios',
          'node_modules/@aws-sdk',
          'node_modules/nodemailer',
        ],
      },
    },

    // Domain must not reach into the application layer either — dependencies
    // point inward only.
    {
      name: 'domain-does-not-know-application',
      severity: 'error',
      comment: 'Dependencies point inward. domain/ is the innermost layer. See docs/06 §1.',
      from: { path: '(^|/)domain/' },
      to: { path: '(^|/)application/' },
    },

    // ---------------------------------------------------------------------
    // Module boundaries. docs/03 §6.1.
    // Modules talk through their published contract (index.ts) and through
    // domain events. Never through each other's internals. This is the single
    // property that makes future service extraction mechanical rather than a
    // rewrite — see docs/17 §4.
    // ---------------------------------------------------------------------
    {
      name: 'no-deep-module-imports',
      severity: 'error',
      comment:
        'Import a module through its public contract only: ' +
        "import { ProjectApi } from '@buildflow/modules/project' — never from its " +
        'domain/, application/, or infrastructure/ folders. See docs/03 §6.1.',
      from: { pathNot: '^packages/modules/([^/]+)/' },
      to: { path: '^packages/modules/[^/]+/src/(domain|application|infrastructure)/' },
    },
    {
      name: 'no-cross-module-internals',
      severity: 'error',
      comment:
        'Module A may not reach into module B internals. Use B public contract or subscribe ' +
        'to its events. See docs/02 §1.1 for the legal context relationships.',
      from: { path: '^packages/modules/([^/]+)/' },
      to: {
        path: '^packages/modules/([^/]+)/src/(domain|application|infrastructure)/',
        pathNot: '^packages/modules/$1/',
      },
    },
    {
      name: 'no-module-cycles',
      severity: 'error',
      comment:
        'Circular dependency between modules. If A and B need each other, one of them ' +
        'should be reacting to an event instead of calling. See docs/03 §8.',
      from: { path: '^packages/(modules|core)/' },
      to: { circular: true },
    },

    // ---------------------------------------------------------------------
    // Controllers stay thin. docs/06 §6.2.
    // A controller parses, dispatches, and presents. The moment it contains a
    // business `if`, that rule has escaped the domain and is now untestable and
    // unreusable by the mobile API, the worker, and the next interface we add.
    // ---------------------------------------------------------------------
    {
      name: 'controllers-are-thin',
      severity: 'error',
      comment:
        'Controllers must not import domain objects directly. Dispatch a command or query ' +
        'and let the application layer own orchestration. See docs/06 §6.2.',
      from: { path: '(^|/)interface/(controllers|routes)/' },
      to: { path: '(^|/)domain/(?!.*\\.(dto|type)\\.ts$)' },
    },

    // ---------------------------------------------------------------------
    // Tenant isolation. docs/03 §5.2 / docs/11 §4.
    // Raw SQL bypasses the Prisma client extension that injects company_id.
    // That extension is the single control preventing a cross-tenant data
    // breach, so raw SQL is confined to one audited directory where every
    // query is reviewed and takes companyId as a bound parameter.
    // ---------------------------------------------------------------------
    {
      name: 'no-raw-sql-outside-audited-dir',
      severity: 'error',
      comment:
        'Raw SQL bypasses tenant scoping. Confine it to packages/database/src/raw/ where ' +
        'every query is reviewed and binds companyId explicitly. See docs/11 §4.',
      from: { pathNot: '^packages/database/src/raw/' },
      to: { path: 'node_modules/@prisma/client/.*runtime.*raw' },
    },
    {
      name: 'prisma-only-in-infrastructure',
      severity: 'error',
      comment:
        'Prisma is an infrastructure detail. Only repositories and the database package may ' +
        'import it. Application code depends on ports. See docs/06 §5.',
      from: {
        path: '^packages/',
        pathNot: '^packages/(database)/|(^|/)infrastructure/|\\.test\\.ts$',
      },
      to: { path: 'node_modules/@prisma/client' },
    },

    // ---------------------------------------------------------------------
    // Shared kernel purity. docs/02 §2.
    // ---------------------------------------------------------------------
    {
      name: 'core-has-no-io',
      severity: 'error',
      comment:
        'packages/core is the shared kernel: pure types and value objects, zero I/O. ' +
        'Everything in it must be usable in a unit test with no container running.',
      from: { path: '^packages/core/' },
      to: {
        path: [
          'node_modules/@prisma/client',
          'node_modules/fastify',
          'node_modules/ioredis',
          'node_modules/bullmq',
          'node_modules/axios',
        ],
      },
    },
    {
      name: 'core-depends-on-nothing-internal',
      severity: 'error',
      comment: 'The shared kernel is the base of the dependency graph and imports no workspace package.',
      from: { path: '^packages/core/' },
      to: { path: '^packages/(?!core/)' },
    },

    // ---------------------------------------------------------------------
    // General hygiene
    // ---------------------------------------------------------------------
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make modules impossible to reason about or extract.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Unreachable file — dead code, or a missing wiring step.',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$',
          '(^|/)(eslint|prettier|vitest|vite|tailwind)\\.config\\.(js|cjs|mjs|ts)$',
          '(^|/)index\\.ts$',
          // Shared config presets and build scripts are consumed by tooling
          // outside the module graph (an app's tailwind.config.js, a package
          // script), so they are legitimately unreferenced by application code.
          '(^|/)tailwind\\.preset\\.js$',
          '(^|/)scripts/.*\\.mjs$',
        ],
      },
      to: {},
    },
    {
      name: 'no-dev-deps-in-src',
      severity: 'error',
      comment: 'A devDependency imported by shipped code will be missing in production.',
      from: { path: '^(packages|apps)/[^/]+/src/', pathNot: '\\.(test|spec)\\.ts$' },
      to: { dependencyTypes: ['npm-dev'] },
    },
    {
      name: 'no-deprecated-core',
      severity: 'error',
      comment: 'Deprecated Node core module.',
      from: {},
      to: { dependencyTypes: ['core'], path: '^(punycode|domain|sys|constants)$' },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.(test|spec)\\.ts$|/dist/|/coverage/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.ts', '.d.ts', '.vue'],
    },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/(@[^/]+/[^/]+|[^/]+)' },
      archi: { collapsePattern: '^(packages|apps)/[^/]+/src/[^/]+' },
      text: { highlightFocused: true },
    },
  },
}
