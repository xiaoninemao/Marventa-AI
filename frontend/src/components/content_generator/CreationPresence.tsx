"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { localizeErrorMessage } from "@/i18n/errors";
import { leave_creation_presence, update_creation_presence } from "@/services/content_generator_api";
import { auth_headers } from "@/services/api_core";
import type { CreationPresenceMember } from "@/types/content_generator";
import { createCreationPresence, type CreationPresenceState } from "@/utils/creation_presence";
import { userAvatarColor, userAvatarInitial } from "@/utils/user_avatar";

function PresenceAvatar({ member }: { member: CreationPresenceMember }) {
  const [imageError, setImageError] = useState(false);
  const name = member.nickname || member.username;
  const initial = userAvatarInitial(name);
  const hasImage = Boolean(member.avatar_url && !imageError);

  return (
    <span className={`amp-creation-presence-avatar ${hasImage ? "" : userAvatarColor(member.id)}`}
      role="img" aria-label={name} title={name} tabIndex={0}>
      {hasImage ? (
        <Image src={member.avatar_url} alt="" width={28} height={28} unoptimized draggable={false}
          className="h-full w-full object-cover" onError={() => setImageError(true)} />
      ) : initial}
    </span>
  );
}

function PresenceMembers({ sessionId, userId }: { sessionId: string; userId: string }) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<CreationPresenceState>({ members: [], loading: true, error: null });

  useEffect(() => {
    const headers = auth_headers();
    const connection = createCreationPresence({
      heartbeat: async (clientId, signal) => {
        const response = await update_creation_presence(sessionId, clientId, signal, headers);
        if (!response.success) throw new Error(response.message || "Could not update creation presence");
        return response.data.members;
      },
      leave: (clientId) => leave_creation_presence(sessionId, clientId, headers),
      onUpdate: setState,
      onLeaveError: (error) => console.warn("Could not leave creation presence", error),
    });
    const refreshVisiblePage = () => {
      if (document.visibilityState !== "hidden") connection.refresh();
    };
    const joinPage = () => { connection.start(); connection.refresh(); };
    const leavePage = () => connection.stop();
    connection.start();
    document.addEventListener("visibilitychange", refreshVisiblePage);
    window.addEventListener("pagehide", leavePage);
    window.addEventListener("pageshow", joinPage);
    return () => {
      document.removeEventListener("visibilitychange", refreshVisiblePage);
      window.removeEventListener("pagehide", leavePage);
      window.removeEventListener("pageshow", joinPage);
      connection.stop();
    };
  }, [sessionId, userId]);

  if (state.error) {
    return (
      <span className="amp-creation-presence-status" role="status" title={localizeErrorMessage(state.error, locale)}>
        {t("在线状态暂不可用", "Presence unavailable")}
      </span>
    );
  }
  if (state.loading) {
    return <span className="amp-creation-presence-status" role="status">{t("正在加载在线成员…", "Loading viewers…")}</span>;
  }

  const members = [...state.members].sort((a, b) => (
    Number(b.id === userId) - Number(a.id === userId)
    || (a.nickname || a.username).localeCompare(b.nickname || b.username, locale)
  ));
  const overflow = members.slice(4);

  return (
    <div className="amp-creation-presence" role="group"
      aria-label={t("正在此创作中的成员（{count} 人）", "People viewing this creation ({count})", { count: members.length })}>
      {members.slice(0, 4).map((member) => (
        <PresenceAvatar key={`${member.id}:${member.avatar_url}`} member={member} />
      ))}
      {overflow.length > 0 && (
        <span className="amp-creation-presence-avatar amp-creation-presence-more" tabIndex={0}
          title={overflow.map((member) => member.nickname || member.username).join(", ")}
          aria-label={t("另有 {count} 位在线成员", "{count} more people online", { count: overflow.length })}>
          +{overflow.length}
        </span>
      )}
    </div>
  );
}

export default function CreationPresence({ sessionId }: { sessionId: string }) {
  const { user } = useAuth();
  if (!user) return null;
  const organization = user.current_organization ?? user.default_organization;
  return <PresenceMembers key={`${user.id}:${organization.id}:${sessionId}`} sessionId={sessionId} userId={user.id} />;
}
