/** Legacy host adapter; chat layout is implemented by the optional console module. */
import { initChatWindow as attach } from '../../../modules/chat-console/src/layout';
import { attachWindowResize, raiseWindow, releaseWindow } from './window-resize';
export function initChatWindow() {
  return attach(document.querySelector<HTMLElement>('#flight-console .viewport')!, document.getElementById('chat-overlay')!, { resize: attachWindowResize, raise: raiseWindow, release: releaseWindow });
}
