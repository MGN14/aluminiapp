// Feedback sonoro para las estaciones de escaneo (despacho / conteo). Permite
// que el operario confirme cada escaneo sin mirar la pantalla:
//   ok   → pitido agudo breve
//   warn → pitido grave doble (referencia desconocida / sobre-conteo)
//
// El AudioContext se crea perezosamente tras el primer gesto del usuario
// (tocar una tarjeta, un escaneo) para cumplir las políticas de autoplay.

let audioCtx: AudioContext | null = null;

export function beep(kind: 'ok' | 'warn') {
  try {
    if (!audioCtx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      audioCtx = new Ctor();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const ctx = audioCtx;
    const play = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    };
    if (kind === 'ok') play(880, 0, 0.09);
    else { play(320, 0, 0.12); play(320, 0.16, 0.12); }
  } catch {
    /* sin audio, el resto del flujo sigue funcionando */
  }
}
