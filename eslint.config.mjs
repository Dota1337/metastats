import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Sprach-Adressen (SEO Weg C, app/lib/lang-path.ts): ein interner Link als
// fester Text ('/tft/comps') verliert unter /en/… die Sprache. Links laufen
// ueber withLang() aus useI18n() (Server: withLangPrefix + getServerPathLang).
// Deckel 0 in scripts/check-eslint-budget.mjs. Schraegstrich als \x2F: der
// Selektor-Parser beendet Regex am ersten echten Schraegstrich.
const INTERNAL_PATH = '/^\\x2F(?!\\x2F|api\\x2F|internal|auth\\x2F|companion\\x2F|_next\\x2F)/';
const INTERNAL_VALUE = `:matches(Literal[value=${INTERNAL_PATH}], TemplateLiteral[quasis.0.value.raw=${INTERNAL_PATH}], BinaryExpression[left.value=${INTERNAL_PATH}])`;
const LANG_LINK_MSG = 'Interner Link ohne Sprach-Adresse: withLang(...) aus useI18n() nutzen (Server: withLangPrefix + getServerPathLang).';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ['app/**/*.ts', 'app/**/*.tsx'],
    ignores: ['app/internal/**', 'app/companion/**', 'app/auth/**', 'app/api/**', 'app/**/*.test.*'],
    rules: {
      'no-restricted-syntax': ['error',
        { selector: `JSXAttribute[name.name='href'] > ${INTERNAL_VALUE}`, message: LANG_LINK_MSG },
        { selector: `JSXAttribute[name.name='href'] > JSXExpressionContainer > ${INTERNAL_VALUE}`, message: LANG_LINK_MSG },
        { selector: `CallExpression[callee.object.name='router'][callee.property.name=/^(push|replace)$/] > ${INTERNAL_VALUE}`, message: LANG_LINK_MSG },
        { selector: `CallExpression[callee.object.property.name='location'][callee.property.name=/^(assign|replace)$/] > ${INTERNAL_VALUE}`, message: LANG_LINK_MSG },
        { selector: `CallExpression[callee.name='redirect'] > ${INTERNAL_VALUE}`, message: LANG_LINK_MSG },
        { selector: `AssignmentExpression[left.property.name='href'] > ${INTERNAL_VALUE}.right`, message: LANG_LINK_MSG },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Overwolf-App: eigenes Paket mit eigenem Build und Lint.
    "apps/**",
  ]),
]);

export default eslintConfig;
