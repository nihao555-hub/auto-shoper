import { Eye, EyeSlash, LockKey, ShieldCheck, Storefront } from "@phosphor-icons/react";
import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError, login, register } from "../api";
import type { AuthUser, RegisterPayload } from "../types";
import { BrandMark } from "./BrandMark";

type AuthMode = "login" | "register";

type AuthPageProps = {
  onAuthenticated: (user: AuthUser) => void;
};

const emptyRegistration: RegisterPayload = {
  email: "",
  password: "",
  display_name: "",
  workspace_name: "",
  registration_code: "",
};

export function AuthPage({ onAuthenticated }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registration, setRegistration] = useState(emptyRegistration);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const registrationCodeError = mode === "register" && error?.includes("注册码") ? error : null;

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError(null);
    setShowPassword(false);
  };

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      onAuthenticated(await login(email, password));
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "登录失败，请稍后再试");
    } finally {
      setSubmitting(false);
    }
  };

  const submitRegistration = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      onAuthenticated(await register(registration));
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "注册失败，请稍后再试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-visual" aria-label="平台业务介绍">
        <img src="/auth-business.webp" alt="" />
      </section>

      <section className={`auth-panel ${mode === "register" ? "is-register" : ""}`}>
        <div className="auth-product-brand">
          <div className="auth-product-brand-row">
            <BrandMark size={40} />
            <strong>上品台</strong>
          </div>
          <span>Alibaba 国际站商品发布工作区</span>
        </div>

        <div className="auth-card">
          <div className="auth-tabs" role="tablist" aria-label="登录或注册">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              className={mode === "login" ? "is-active" : ""}
              onClick={() => switchMode("login")}
            >
              登录
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "register"}
              className={mode === "register" ? "is-active" : ""}
              onClick={() => switchMode("register")}
            >
              注册
            </button>
          </div>

          {mode === "login" ? (
            <form className="auth-form" onSubmit={submitLogin}>
              <AuthField
                label="邮箱"
                type="email"
                value={email}
                autoComplete="email"
                placeholder="name@company.com"
                onChange={setEmail}
              />
              <PasswordField
                value={password}
                autoComplete="current-password"
                showPassword={showPassword}
                onChange={setPassword}
                onToggle={() => setShowPassword((visible) => !visible)}
              />
              {error ? (
                <div className="auth-error" role="alert">
                  {error}
                </div>
              ) : null}
              <button
                type="submit"
                className="auth-submit"
                disabled={submitting}
                aria-busy={submitting}
              >
                <span>{submitting ? "正在登录…" : "登录并进入工作区"}</span>
              </button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={submitRegistration}>
              <AuthField
                label="姓名"
                value={registration.display_name}
                autoComplete="name"
                placeholder="请输入您的姓名"
                onChange={(value) =>
                  setRegistration((current) => ({ ...current, display_name: value }))
                }
              />
              <AuthField
                label="工作区名称"
                value={registration.workspace_name}
                autoComplete="organization"
                placeholder="请输入工作区名称"
                onChange={(value) =>
                  setRegistration((current) => ({ ...current, workspace_name: value }))
                }
              />
              <AuthField
                label="工作邮箱"
                type="email"
                value={registration.email}
                autoComplete="email"
                placeholder="请输入工作邮箱"
                hint="用于接收系统通知与安全验证"
                onChange={(value) => setRegistration((current) => ({ ...current, email: value }))}
              />
              <PasswordField
                value={registration.password}
                autoComplete="new-password"
                showPassword={showPassword}
                hint="10–16 位，包含字母、数字和符号"
                onChange={(value) =>
                  setRegistration((current) => ({ ...current, password: value }))
                }
                onToggle={() => setShowPassword((visible) => !visible)}
              />
              <label className="auth-field auth-field-code">
                <span>注册码</span>
                <input
                  value={registration.registration_code}
                  autoComplete="one-time-code"
                  placeholder="请输入注册码"
                  aria-invalid={Boolean(registrationCodeError)}
                  aria-describedby="registration-code-help"
                  onChange={(event) =>
                    setRegistration((current) => ({
                      ...current,
                      registration_code: event.target.value,
                    }))
                  }
                  required
                />
                <small
                  id="registration-code-help"
                  className={registrationCodeError ? "auth-field-error" : "auth-field-hint"}
                >
                  {registrationCodeError ?? "向邀请人获取注册码，一码一次"}
                </small>
              </label>
              {error && !registrationCodeError ? (
                <div className="auth-error" role="alert">
                  {error}
                </div>
              ) : null}
              <button
                type="submit"
                className="auth-submit"
                disabled={submitting}
                aria-busy={submitting}
              >
                <span>{submitting ? "正在创建…" : "创建独立工作区"}</span>
              </button>
            </form>
          )}

          <div className="auth-trust">
            <span>
              <ShieldCheck size={16} /> 密码安全哈希
            </span>
            <span>
              <LockKey size={16} /> Token 加密存储
            </span>
            <span>
              <Storefront size={16} /> 店铺数据隔离
            </span>
          </div>
        </div>

        <p className="auth-footer">仅向受邀客户开放 · 登录即表示你同意平台安全规范</p>
      </section>
    </main>
  );
}

function AuthField({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete: string;
  placeholder: string;
  hint?: string;
}) {
  return (
    <label className="auth-field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        required
      />
      {hint ? <small className="auth-field-hint">{hint}</small> : null}
    </label>
  );
}

function PasswordField({
  value,
  onChange,
  showPassword,
  onToggle,
  autoComplete,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  showPassword: boolean;
  onToggle: () => void;
  autoComplete: string;
  hint?: string;
}) {
  return (
    <label className="auth-field">
      <span>密码</span>
      <div className="auth-password">
        <input
          type={showPassword ? "text" : "password"}
          value={value}
          minLength={autoComplete === "new-password" ? 10 : undefined}
          autoComplete={autoComplete}
          placeholder={autoComplete === "new-password" ? "请设置密码" : "请输入密码"}
          onChange={(event) => onChange(event.target.value)}
          required
        />
        <button
          type="button"
          aria-label={showPassword ? "隐藏密码" : "显示密码"}
          onClick={onToggle}
        >
          {showPassword ? <EyeSlash size={19} /> : <Eye size={19} />}
        </button>
      </div>
      {hint ? <small className="auth-field-hint">{hint}</small> : null}
    </label>
  );
}
