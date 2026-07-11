import {
  ArrowRight,
  Check,
  Eye,
  EyeSlash,
  Key,
  LockKey,
  ShieldCheck,
  Storefront,
} from "@phosphor-icons/react";
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
        <div className="auth-visual-shade" />
        <div className="auth-visual-brand">
          <BrandMark size={38} />
          <div>
            <strong>上品台</strong>
            <span>Alibaba 国际站商品发布工作区</span>
          </div>
        </div>
        <div className="auth-visual-copy">
          <span className="auth-kicker">从素材到 Alibaba 草稿</span>
          <h1>把跨境商品发布，变成一条清晰、可信的工作流。</h1>
          <p>图片成组、AI 候选、类目规则、人工确认与草稿回读，都留在同一个店铺上下文中。</p>
          <div className="auth-proof-list">
            <span>
              <Check weight="bold" /> 多店铺严格隔离
            </span>
            <span>
              <Check weight="bold" /> 真实 Schema 校验
            </span>
            <span>
              <Check weight="bold" /> 发布前人工门禁
            </span>
          </div>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-mobile-brand">
          <BrandMark size={36} />
          <div>
            <strong>上品台</strong>
            <span>跨境商品发布</span>
          </div>
        </div>

        <div className="auth-card">
          <div className="auth-heading">
            <span className="eyebrow">{mode === "login" ? "欢迎回来" : "创建客户工作区"}</span>
            <h2>{mode === "login" ? "登录上品台" : "使用注册码开始"}</h2>
            <p>
              {mode === "login"
                ? "进入你的独立工作区，继续管理店铺和上品批次。"
                : "每个客户拥有独立工作区；注册码使用一次后自动失效。"}
            </p>
          </div>

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
              {error ? <div className="auth-error">{error}</div> : null}
              <button type="submit" className="auth-submit" disabled={submitting}>
                <span>{submitting ? "正在登录…" : "进入工作区"}</span>
                <ArrowRight size={19} />
              </button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={submitRegistration}>
              <div className="auth-form-grid">
                <AuthField
                  label="你的姓名"
                  value={registration.display_name}
                  autoComplete="name"
                  placeholder="怎么称呼你"
                  onChange={(value) =>
                    setRegistration((current) => ({ ...current, display_name: value }))
                  }
                />
                <AuthField
                  label="工作区名称"
                  value={registration.workspace_name}
                  autoComplete="organization"
                  placeholder="公司或团队名称"
                  onChange={(value) =>
                    setRegistration((current) => ({ ...current, workspace_name: value }))
                  }
                />
              </div>
              <AuthField
                label="工作邮箱"
                type="email"
                value={registration.email}
                autoComplete="email"
                placeholder="name@company.com"
                onChange={(value) => setRegistration((current) => ({ ...current, email: value }))}
              />
              <PasswordField
                value={registration.password}
                autoComplete="new-password"
                showPassword={showPassword}
                hint="至少 10 位"
                onChange={(value) =>
                  setRegistration((current) => ({ ...current, password: value }))
                }
                onToggle={() => setShowPassword((visible) => !visible)}
              />
              <label className="auth-field">
                <span>注册码</span>
                <div className="auth-input-with-icon">
                  <Key size={18} />
                  <input
                    value={registration.registration_code}
                    autoComplete="one-time-code"
                    placeholder="输入管理员提供的注册码"
                    onChange={(event) =>
                      setRegistration((current) => ({
                        ...current,
                        registration_code: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
              </label>
              {error ? <div className="auth-error">{error}</div> : null}
              <button type="submit" className="auth-submit" disabled={submitting}>
                <span>{submitting ? "正在创建…" : "创建独立工作区"}</span>
                <ArrowRight size={19} />
              </button>
            </form>
          )}

          <div className="auth-trust">
            <span>
              <ShieldCheck size={17} /> 密码安全哈希
            </span>
            <span>
              <LockKey size={17} /> Token 加密存储
            </span>
            <span>
              <Storefront size={17} /> 店铺数据隔离
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete: string;
  placeholder: string;
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
      <span>
        密码
        {hint ? <small>{hint}</small> : null}
      </span>
      <div className="auth-password">
        <input
          type={showPassword ? "text" : "password"}
          value={value}
          minLength={autoComplete === "new-password" ? 10 : undefined}
          autoComplete={autoComplete}
          placeholder="输入密码"
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
    </label>
  );
}
