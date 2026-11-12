export class FrameRate {
  private times: number[] = [];

  add(time: number) {
    this.times.push(time);
    while (this.times.length > 1 && time - this.times[0] > 1500) this.times.shift();
  }

  get(now: number) {
    const last = this.times.at(-1);
    const elapsed = last === undefined ? 0 : last - this.times[0];
    if (last === undefined || now - last > 1500 || elapsed <= 0) return 0;
    return Math.round(((this.times.length - 1) * 1000) / elapsed);
  }

  reset() {
    this.times = [];
  }
}
