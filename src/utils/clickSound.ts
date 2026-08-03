import clickSoundSrc from '../assets/ui/click.mp3';

// A single shared Audio instance rather than creating a new one on every
// click, to avoid the overhead of allocating and decoding a fresh element
// each time a button is pressed.
const clickAudio = new Audio(clickSoundSrc);

export function playClickSound() {
  // Reset to the start so rapid, repeated clicks retrigger the sound from
  // the beginning instead of being ignored while the previous playback is
  // still finishing.
  clickAudio.currentTime = 0;

  // play() returns a promise that rejects if the browser's autoplay policy
  // blocks it. Since this only ever runs in direct response to a click (a
  // genuine user gesture), that shouldn't happen in practice — the catch
  // just avoids an unhandled promise rejection warning in the rare case it
  // does.
  void clickAudio.play().catch(() => {});
}
