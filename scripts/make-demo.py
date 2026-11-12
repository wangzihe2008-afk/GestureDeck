"""Optional developer utility. The generated PDF/icon are already included.
Regenerate with Python 3 + reportlab + Pillow. No Python required to run the app.
"""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
public = root / "public"
fonts = public / "pdf-assets" / "standard_fonts"
pdfmetrics.registerFont(TTFont("GestureSans", str(fonts / "LiberationSans-Regular.ttf")))
pdfmetrics.registerFont(TTFont("GestureSans-Bold", str(fonts / "LiberationSans-Bold.ttf")))
pdf = canvas.Canvas(str(public / "demo.pdf"), pagesize=(960, 540))
pdf.setTitle("GestureDeck - Your first hands-free presentation")
slides = [
    (
        "GESTUREDECK / 01",
        "Your pose.",
        "Your next slide.",
        "Hold a saved body pose to control your presentation.",
        "Use the arrow keys now. Try your saved pose when the camera is ready.",
    ),
    (
        "GET READY / 02",
        "Face the camera.",
        "Keep your arms in view.",
        "Both shoulders, elbows and wrists should stay inside the frame.",
        "Capture and test from the same place you will stand during your presentation.",
    ),
    (
        "POSE STUDIO / 03",
        "Capture once.",
        "Hold still.",
        "Choose a pose and a command. Hold still for the 0.7-second capture.",
        "Click Capture pose, get into position during the countdown, then click Save pose.",
    ),
    (
        "TEST YOUR POSE / 04",
        "One pose.",
        "One slide change.",
        "Enable control and hold a saved pose. Lower your arms after the slide changes.",
        "Holding the same pose keeps this slide in place. Leave the pose before trying again.",
    ),
    (
        "TRY AGAIN / 05",
        "Lower your arms.",
        "Then pose again.",
        "After the brief cooldown, repeat. Test Next, Previous and Black Screen.",
        "PDF: arrow keys to navigate. B to black out. Esc to pause recognition.",
    ),
]
for i, (tag, line1, line2, sub, foot) in enumerate(slides):
    pdf.setFillColor(HexColor("#214b3f")); pdf.rect(0, 0, 960, 540, fill=1, stroke=0)
    pdf.setStrokeColor(HexColor("#345b48")); pdf.setLineWidth(1)
    for x in range(600, 960, 28): pdf.line(x, 0, x, 540)
    for y in range(0, 541, 28): pdf.line(600, y, 960, y)
    pdf.setFillColor(HexColor("#b9cda0")); pdf.setFont("GestureSans", 11); pdf.drawString(64, 476, tag)
    pdf.setFillColor(HexColor("#f6f8ed")); pdf.setFont("GestureSans-Bold", 53); pdf.drawString(64, 338, line1)
    pdf.setFillColor(HexColor("#d4e8ae")); pdf.drawString(64, 274, line2)
    pdf.setFillColor(HexColor("#b9cda7")); pdf.setFont("GestureSans", 14); pdf.drawString(66, 218, sub)
    pdf.setStrokeColor(HexColor("#78965d")); pdf.setLineWidth(3)
    pdf.line(66, 171, 146, 171)
    pdf.setFillColor(HexColor("#91ad81")); pdf.setFont("GestureSans", 11); pdf.drawString(66, 80, foot)
    pdf.setFont("GestureSans", 10); pdf.drawRightString(896, 37, f"{i+1:02d} / 05")
    pdf.setFillColor(HexColor("#d5e8ad")); pdf.roundRect(836, 425, 60, 60, 15, fill=1, stroke=0)
    pdf.setStrokeColor(HexColor("#355d3f")); pdf.setLineWidth(4)
    p=pdf.beginPath(); p.moveTo(859, 443); p.lineTo(874, 455); p.lineTo(859, 467); pdf.drawPath(p)
    pdf.showPage()
pdf.save()

image = Image.new("RGB", (128, 128), "#174d42")
d = ImageDraw.Draw(image)
d.rounded_rectangle((5,5,123,123), radius=30, fill="#174d42")
d.line([(33,82),(33,47),(42,37),(89,37)], fill="#d6edac", width=8)
d.line([(48,92),(87,92),(96,82),(96,50)], fill="#d6edac", width=8)
d.line([(59,52),(76,64),(59,76)], fill="white", width=8)
image.save(public / "icon.png")
print("Demo PDF and extension icon generated.")
