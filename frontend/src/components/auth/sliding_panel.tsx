"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import LanguageSwitcher from "@/components/shared/language_switcher";
import InlineIcon from "@/components/redesign/InlineIcon";
import RedesignButton from "@/components/redesign/RedesignButton";
import RedesignInput from "@/components/redesign/RedesignInput";

interface Props {
  mode: "login" | "register";
  open: boolean;
  onClose: () => void;
  onSwitch: () => void;
}

const featureItems = [
  { iconSrc: "/assets/icons/login-market.png", title: "市场洞察分析", titleEn: "Market Insight", copy: "多维数据分析，洞察市场趋势", copyEn: "Explore data and market trends" },
  { iconSrc: "/assets/icons/login-content.png", title: "智能内容生成", titleEn: "AI Content Creation", copy: "AI 驱动创作，提升内容效率", copyEn: "Create more efficiently with AI" },
  { iconSrc: "/assets/icons/login-compare.png", title: "竞品深度对比", titleEn: "Competitor Analysis", copy: "全面对比分析，发现竞争优势", copyEn: "Compare competitors and find your edge" },
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SlidingPanel({ mode, open, onClose, onSwitch }: Props) {
  const { login, register } = useAuth();
  const { t, locale } = useI18n();
  const { showError } = useToast();
  const [loading, setLoading] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);

  const isLogin = mode === "login";
  const resetForm = useCallback(() => {
    setLoading(false);
    setLoginEmail("");
    setLoginPassword("");
    setShowLoginPassword(false);
    setRegisterEmail("");
    setRegisterPassword("");
    setShowRegisterPassword(false);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleSwitch = useCallback(() => {
    resetForm();
    onSwitch();
  }, [onSwitch, resetForm]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, handleClose]);

  if (!open) return null;

  const doLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!loginEmail.trim() || !loginPassword) {
      showError(t("请填写邮箱和密码", "Enter your email and password."));
      return;
    }
    setLoading(true);
    try {
      await login(loginEmail.trim(), loginPassword);
      handleClose();
    } catch (err) {
      showError(localizeErrorMessage(err instanceof Error ? err.message : "登录失败", locale));
    } finally {
      setLoading(false);
    }
  };

  const doRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    const email = registerEmail.trim();
    if (!email || !registerPassword) {
      showError(t("请填写邮箱和密码", "Enter your email and password."));
      return;
    }
    if (!EMAIL_PATTERN.test(email)) {
      showError(t("邮箱格式不正确", "Enter a valid email address."));
      return;
    }
    if (registerPassword.length < 6) {
      showError(t("密码至少需要 6 个字符", "Use at least 6 characters for your password."));
      return;
    }
    setLoading(true);
    try {
      await register(email, registerPassword);
      handleClose();
    } catch (err) {
      showError(localizeErrorMessage(err instanceof Error ? err.message : "注册失败", locale));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="amp-redesign">
      <div className="amp-slide-root">
        <button type="button" className="amp-slide-overlay" aria-label={t("关闭登录面板", "Close sign-in panel")} onClick={handleClose} />
        <aside className="amp-slide-panel" role="dialog" aria-modal="true" aria-label={isLogin ? t("登录账号", "Sign in") : t("创建账号", "Create account")}>
          <section className="amp-slide-brand-panel">
            <div className="amp-slide-brand-content">
              <div className="amp-slide-brand-main">
                <p className="amp-slide-brand-kicker">Marventa AI</p>
                <h2>{t("欢迎回来，继续你的 AI 营销增长旅程", "Welcome back. Continue your AI marketing journey.")}</h2>
              </div>

              <div className="amp-slide-feature-list">
                {featureItems.map((item) => (
                  <div key={item.title} className="amp-slide-feature-item">
                    <span>
                      <img src={item.iconSrc} alt="" />
                    </span>
                    <div>
                      <strong>{t(item.title, item.titleEn)}</strong>
                      <small>{t(item.copy, item.copyEn)}</small>
                    </div>
                  </div>
                ))}
              </div>

              <div className="amp-slide-sme-badge">
                <img src="/assets/icons/login-sme.svg" alt="" />
                <InlineIcon name="check" className="amp-slide-sme-fallback-icon" />
                <span>{t("面向科技型中小企业", "Built for tech SMEs")}</span>
              </div>
            </div>
          </section>

          <section className={`amp-slide-form-panel ${isLogin ? "is-login" : "is-register"}`}>
            <div className="amp-slide-topline">
              <LanguageSwitcher />
              <span>{isLogin ? t("没有账号？", "New here?") : t("已有账号？", "Have an account?")}</span>
              <button type="button" onClick={handleSwitch}>
                {isLogin ? t("立即注册", "Sign up") : t("立即登录", "Sign in")}
              </button>
              <button type="button" onClick={handleClose} className="amp-modal-close" aria-label={t("关闭", "Close")}>
                <InlineIcon name="close" className="h-5 w-5" />
              </button>
            </div>

            <h2 className="amp-form-title">{isLogin ? t("登录账号", "Sign in") : t("创建账号", "Create account")}</h2>
            <p className="amp-form-subtitle">
              {isLogin ? t("登录你的 Marventa AI 账号", "Sign in to your Marventa AI account") : t("注册后即可使用 Marventa AI", "Sign up to use Marventa AI")}
            </p>

            {isLogin ? (
              <form onSubmit={doLogin} className="amp-login-compact-form" noValidate>
                <label>
                  <span className="amp-form-label">{t("邮箱", "Email")}</span>
                  <RedesignInput
                    autoFocus
                    autoComplete="email"
                    leftIcon={<InlineIcon name="mail" className="h-5 w-5" />}
                    onChange={(event) => setLoginEmail(event.target.value)}
                    placeholder={t("请输入邮箱", "Enter your email")}
                    type="email"
                    value={loginEmail}
                  />
                </label>
                <label>
                  <span className="amp-form-label">{t("密码", "Password")}</span>
                  <RedesignInput
                    leftIcon={<InlineIcon name="lock" className="h-5 w-5" />}
                    onChange={(event) => setLoginPassword(event.target.value)}
                    placeholder={t("请输入密码", "Enter your password")}
                    rightIcon={<InlineIcon name={showLoginPassword ? "eye" : "eyeOff"} className="h-5 w-5" />}
                    rightIconLabel={showLoginPassword ? t("隐藏密码", "Hide password") : t("显示密码", "Show password")}
                    onRightIconClick={() => setShowLoginPassword((value) => !value)}
                    type={showLoginPassword ? "text" : "password"}
                    value={loginPassword}
                  />
                </label>

                <RedesignButton type="submit" disabled={loading} className="amp-login-submit">
                  {loading ? t("登录中...", "Signing in...") : t("登录", "Sign in")}
                </RedesignButton>
              </form>
            ) : (
              <form onSubmit={doRegister} className="amp-login-compact-form amp-register-compact-form" noValidate>
                <label>
                  <span className="amp-form-label">{t("邮箱", "Email")}</span>
                  <RedesignInput
                    autoFocus
                    autoComplete="email"
                    leftIcon={<InlineIcon name="mail" className="h-5 w-5" />}
                    onChange={(event) => setRegisterEmail(event.target.value)}
                    placeholder={t("请输入邮箱", "Enter your email")}
                    type="email"
                    value={registerEmail}
                  />
                </label>
                <label>
                  <span className="amp-form-label">{t("密码", "Password")}</span>
                  <RedesignInput
                    leftIcon={<InlineIcon name="lock" className="h-5 w-5" />}
                    onChange={(event) => setRegisterPassword(event.target.value)}
                    placeholder={t("至少 6 个字符", "At least 6 characters")}
                    rightIcon={<InlineIcon name={showRegisterPassword ? "eye" : "eyeOff"} className="h-5 w-5" />}
                    rightIconLabel={showRegisterPassword ? t("隐藏密码", "Hide password") : t("显示密码", "Show password")}
                    onRightIconClick={() => setShowRegisterPassword((value) => !value)}
                    type={showRegisterPassword ? "text" : "password"}
                    value={registerPassword}
                  />
                </label>

                <RedesignButton type="submit" disabled={loading} className="amp-login-submit">
                  {loading ? t("注册中...", "Creating account...") : t("创建账号", "Create account")}
                </RedesignButton>
              </form>
            )}

          </section>
        </aside>
      </div>
    </div>
  );
}
