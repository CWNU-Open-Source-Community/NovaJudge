// Browser event raised when the viewer's own submission is accepted.
export const ACCEPTED_EVENT = "novajudge:accepted";

export interface AcceptedEventDetail {
  problem?: string;
  color?: string | null;
}

export function announceAccepted(detail: AcceptedEventDetail) {
  window.dispatchEvent(new CustomEvent<AcceptedEventDetail>(ACCEPTED_EVENT, { detail }));
}
