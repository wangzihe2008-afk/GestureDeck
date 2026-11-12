self.onmessage = async ({ data }) => {
  const writer = data.writable.getWriter();
  const canvas = new OffscreenCanvas(640, 480);
  const context = canvas.getContext('2d');
  let count = 0;

  try {
    while (true) {
      context.fillStyle = count % 2 ? '#214b3f' : '#507d67';
      context.fillRect(0, 0, 640, 480);

      const frame = new VideoFrame(canvas, { timestamp: count++ * 33333 });

      try {
        await writer.write(frame);
      } finally {
        frame.close();
      }

      await new Promise((resolve) => setTimeout(resolve, 33));
    }
  } catch {
    writer.releaseLock();
  }
};
