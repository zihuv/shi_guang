export const REQUEST_FOCUS_FIRST_FILE_EVENT = "shiguang:request-focus-first-file"

export function requestFocusFirstFile() {
  window.dispatchEvent(new CustomEvent(REQUEST_FOCUS_FIRST_FILE_EVENT))
}
