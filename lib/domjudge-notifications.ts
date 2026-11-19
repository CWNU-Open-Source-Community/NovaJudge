const preference = "domjudge-desktop-notifications";

export function desktopNotificationsEnabled() {
  return "Notification" in window && Notification.permission === "granted" &&
    localStorage.getItem(preference) === "on";
}

export function setDesktopNotifications(enabled: boolean) {
  localStorage.setItem(preference, enabled ? "on" : "off");
}

export function notifyContestant(title: string, body: string, href: string) {
  try {
    if (!desktopNotificationsEnabled()) return;
    const notification = new Notification(title, { body, tag: href });
    notification.onclick = () => {
      window.focus();
      window.location.assign(href);
      notification.close();
    };
  } catch {
    // Some mobile browsers expose Notification but only support service-worker notifications.
  }
}
