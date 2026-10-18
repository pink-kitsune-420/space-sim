import { createFlightAudio } from '../../../modules/audio-controls/src/index';
export function mountFlightAudio(root: HTMLElement) {
  const factory = createFlightAudio(), control = factory.mount({root,prefix:'sound',
    storage:{getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)} });
  const close = control.dispose.bind(control);
  control.dispose = () => { close(); factory.dispose(); }; return control;
}
