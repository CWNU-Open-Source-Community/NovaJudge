"use client";

import { useEffect, useState } from "react";
import { faBell, faBellSlash } from "@fortawesome/free-solid-svg-icons";
import { toast } from "sonner";
import { desktopNotificationsEnabled, setDesktopNotifications } from "@/lib/domjudge-notifications";
import DomjudgeIcon from "./DomjudgeIcon";

export default function DomjudgeNotificationButton() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const sync = () => {
      try { setEnabled(desktopNotificationsEnabled()); } catch { setEnabled(false); }
    };
    sync();
    window.addEventListener("focus", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  async function toggle() {
    try {
      if (!enabled) {
        if (!("Notification" in window)) {
          toast.info("Desktop notifications are unavailable in this browser.");
          return;
        }
        if (await Notification.requestPermission() !== "granted") {
          toast.info("Allow notifications in your browser’s site settings to receive contest updates.");
          return;
        }
      }
      setDesktopNotifications(!enabled);
      setEnabled(!enabled);
    } catch {
      toast.error("Your browser could not save the notification preference.");
    }
  }
  return <button type="button" className={`dj-action ${enabled ? "dj-secondary" : "dj-notify"}`}
    onClick={toggle} aria-pressed={enabled}>
    <DomjudgeIcon icon={enabled ? faBellSlash : faBell} />{enabled ? "Disable Notifications" : "Enable Notifications"}
  </button>;
}
