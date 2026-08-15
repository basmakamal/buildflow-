<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'

const { t } = useI18n()
const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const route = useRoute()

const companyId = ref('')
const email = ref('')
const password = ref('')

/**
 * Error messages are looked up by the server's stable `code`.
 *
 * The API returns a machine-readable code precisely so the client can render
 * the message in the user's own language — never by displaying the English
 * `title` the server happened to send. docs/06 §9, docs/12 §3
 */
const errorMessage = computed(() => {
  if (!auth.errorCode) return null
  const key = `auth.errors.${auth.errorCode}`
  return t(key) === key ? t('common.state.error') : t(key)
})

async function submit() {
  const ok = await auth.login({
    companyId: companyId.value.trim(),
    email: email.value.trim(),
    password: password.value,
  })
  if (ok) {
    const redirect = route.query['redirect']
    await router.push(typeof redirect === 'string' ? redirect : '/dashboard')
  }
}
</script>

<template>
  <main class="login">
    <div class="login__panel">
      <header class="login__head">
        <div class="login__mark" aria-hidden="true">BF</div>
        <h1>{{ t('auth.title') }}</h1>
        <p>{{ t('auth.subtitle') }}</p>
      </header>

      <form class="login__form" novalidate @submit.prevent="submit">
        <label class="field">
          <span class="field__label">{{ t('auth.fields.companyId') }}</span>
          <input v-model="companyId" class="field__input numeric" autocomplete="organization" />
        </label>

        <label class="field">
          <span class="field__label">{{ t('auth.fields.email') }}</span>
          <input
            v-model="email"
            type="email"
            class="field__input"
            autocomplete="username"
            :placeholder="t('auth.placeholders.email')"
          />
        </label>

        <label class="field">
          <span class="field__label">{{ t('auth.fields.password') }}</span>
          <input
            v-model="password"
            type="password"
            class="field__input"
            autocomplete="current-password"
            :placeholder="t('auth.placeholders.password')"
          />
        </label>

        <!-- role=alert so a screen reader announces the failure immediately -->
        <p v-if="errorMessage" class="login__error" role="alert">{{ errorMessage }}</p>

        <button class="btn btn--primary" type="submit" :disabled="auth.isLoading">
          {{ auth.isLoading ? t('common.state.loading') : t('common.actions.signIn') }}
        </button>
      </form>

      <footer class="login__foot">
        <button class="btn btn--ghost" type="button" @click="ui.toggleLocale()">
          {{ t('common.language.switch') }}
        </button>
        <button
          class="btn btn--ghost"
          type="button"
          :aria-label="t('common.theme.toggle')"
          @click="ui.toggleTheme()"
        >
          {{ ui.theme === 'light' ? t('common.theme.dark') : t('common.theme.light') }}
        </button>
      </footer>
    </div>
  </main>
</template>

<style scoped>
.login {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: var(--bf-space-6);
  background: linear-gradient(
    160deg,
    var(--bf-primary-900) 0%,
    var(--bf-primary-700) 45%,
    var(--bf-primary-600) 100%
  );
}

.login__panel {
  width: 100%;
  max-width: 420px;
  background: var(--bf-surface);
  border-radius: var(--bf-radius-xl);
  box-shadow: var(--bf-shadow-overlay);
  padding: var(--bf-space-8);
}

.login__head {
  text-align: center;
  margin-bottom: var(--bf-space-6);
}

.login__mark {
  width: 48px;
  height: 48px;
  margin: 0 auto var(--bf-space-4);
  display: grid;
  place-items: center;
  border-radius: var(--bf-radius-lg);
  background: var(--bf-primary-600);
  color: #fff;
  font-weight: var(--bf-weight-bold);
  letter-spacing: 0.02em;
}

.login__head h1 {
  font-size: var(--bf-text-xl);
  font-weight: var(--bf-weight-semibold);
  margin: 0 0 var(--bf-space-1);
}

.login__head p {
  margin: 0;
  color: var(--bf-text-muted);
  font-size: var(--bf-text-sm);
}

.login__form {
  display: grid;
  gap: var(--bf-space-4);
}

.field {
  display: grid;
  gap: var(--bf-space-2);
}

.field__label {
  font-size: var(--bf-text-sm);
  font-weight: var(--bf-weight-medium);
}

.field__input {
  /* Logical padding so the same rule is correct in both directions. */
  padding-block: 0.65rem;
  padding-inline: 0.85rem;
  border: 1px solid var(--bf-border);
  border-radius: var(--bf-radius-md);
  background: var(--bf-bg);
  color: var(--bf-text);
  font: inherit;
  transition: border-color var(--bf-duration-micro) var(--bf-ease);
}

.field__input:focus {
  outline: none;
  border-color: var(--bf-primary-600);
  box-shadow: var(--bf-ring);
}

.login__error {
  margin: 0;
  padding: var(--bf-space-3);
  border-radius: var(--bf-radius-md);
  background: var(--bf-danger-bg);
  color: var(--bf-danger);
  font-size: var(--bf-text-sm);
  border-inline-start: 3px solid var(--bf-danger);
}

.btn {
  padding-block: 0.7rem;
  padding-inline: 1rem;
  border-radius: var(--bf-radius-md);
  font: inherit;
  font-weight: var(--bf-weight-medium);
  cursor: pointer;
  border: 1px solid transparent;
  transition: all var(--bf-duration-micro) var(--bf-ease);
}

.btn--primary {
  background: var(--bf-primary-600);
  color: #fff;
}

.btn--primary:hover:not(:disabled) {
  background: var(--bf-primary-700);
}

.btn--primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn--ghost {
  background: transparent;
  color: var(--bf-text-muted);
  border-color: var(--bf-border);
  font-size: var(--bf-text-sm);
}

.btn--ghost:hover {
  color: var(--bf-primary-600);
  border-color: var(--bf-primary-600);
}

.login__foot {
  display: flex;
  justify-content: space-between;
  gap: var(--bf-space-2);
  margin-top: var(--bf-space-6);
  padding-top: var(--bf-space-4);
  border-top: 1px solid var(--bf-border);
}
</style>
