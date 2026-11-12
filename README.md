# CapturePen — Screenshot, Crop & Annotate

A local-first Chrome extension: capture, crop, and mark up screenshots without an account, cloud upload, or ads.

## Features

### Capture
- **Area select:** click the toolbar icon and drag a region (starts immediately, no menu)
- **Visible area:** capture what's on screen in the current tab
- **Full page:** scrolls and stitches the whole page into one image
- **Edit a Mac screenshot (any app, full screen with the tab bar):** press `Cmd+Ctrl+Shift+3` (full screen) or `Cmd+Ctrl+Shift+4` (an area) to put a screenshot on the clipboard, then right-click the CapturePen icon > **Edit screenshot from clipboard**. It opens straight in the editor.
- **Edit an image file:** right-click the icon > **Edit image from file** opens an empty editor; click **Choose a file** or drop an image. In the editor you can also paste (`Ctrl/Cmd+V`), drop, or **Open** an image in the editor at any time; pasting over an open image replaces it, and Undo brings the old one back.
- The screenshot opens in a new editor tab

### Editor tools (toolbar order)
| Tool | Key | What it does |
|---|---|---|
| Select / Move | `V` or `S` | Select, move and resize shapes, lines and text |
| Brush | `B` | Freehand drawing |
| Line | `L` | Straight line. Drag its middle to move it; drag either end to lengthen, shorten or rotate it 360° while the other end stays fixed |
| Arrow | `A` | Arrow pointing at something. Edit it like a line: drag the middle to move, drag either end to stretch or rotate |
| Rectangle | `R` | Outline rectangle |
| Ellipse | `O` | Outline ellipse |
| Text | `T` | PowerPoint-style text box (see below) |
| Crop | `X` | Drag to select an area, then **Apply Crop** or **Cancel** |
| Blur / Pixelate | `P` | Hide sensitive info (emails, names, numbers) |

Color, brush size and font size are set in the sub-toolbar.

### Text boxes
- Click with the Text tool to open a box with a dotted border. Default font size is 16px (slider: 8–120px).
- Text wraps inside the box and the box never goes past the edge of the screenshot.
- Drag any of the 8 handles to change the box width and height. The height is kept, like PowerPoint, and grows if the text needs more room.
- The box stays editable until you press `Esc`, switch tools, click elsewhere on the image (starts a new box), or click outside the screenshot.
- Changing the font size or color while a box is open updates that text immediately.
- **Double-click any text** with any tool to edit it again.

### Editable lines and text
Lines, arrows and text stay editable after you use Brush or Blur. They always draw on top of those strokes, and Blur doesn't affect them. Rectangles and ellipses are flattened into the image when a Brush or Blur stroke starts. Cropping flattens everything.

### Other
- **Undo / Redo:** full history, up to 40 steps
- **Clear all edits:** the red **Clear all** button next to Undo resets the image to how it first opened (after the area-select crop, with no shapes). It is one undo step, so Ctrl/Cmd+Z brings your edits back. It has no keyboard shortcut.
- **Copy to clipboard** or **Download as PNG**
- 100% local: nothing leaves your browser, no login required

## Keyboard shortcuts

**Capture (any tab).** On a Mac, `Alt` is the `Option` key. To change them, go to `chrome://extensions/shortcuts`.
| Shortcut | Action |
|---|---|
| `Alt+Shift+S` | Capture visible area |
| `Alt+Shift+A` | Select an area to capture |

**Editor.** `Ctrl` or `Cmd` both work.
| Shortcut | Action |
|---|---|
| `V`/`S` `B` `L` `A` `R` `O` `T` `X` `P` | Switch tool (see the table above) |
| `Ctrl/Cmd+C` | Copy the edited image |
| `Ctrl/Cmd+V` | Paste an image to edit |
| `?` | Show the keyboard shortcuts (or click the ⓘ button) |
| `Ctrl/Cmd+Z` | Undo |
| `Ctrl/Cmd+Y` | Redo |
| `Delete` / `Backspace` | Delete the selected shape (Select tool) |
| `Esc` | Cancel the crop (Crop tool) |

**Text box**
| Shortcut | Action |
|---|---|
| `Enter` | New line |
| `Esc` | Finish the text and stay on the Text tool |
| Double-click a text | Edit it again |

**Lines**
| Shortcut | Action |
|---|---|
| Hold `Shift` while drawing or dragging an end (lines and arrows) | Snap the angle to 15° steps |

Shortcuts are ignored while you're typing in a text box or holding the mouse down mid-drag. Only the left mouse button draws.

## Install (Developer Mode)
1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this project folder
5. Pin the CapturePen icon to your toolbar for quick access

After editing the code, click the reload icon on the CapturePen card at `chrome://extensions`.

## How to use
- **Click the CapturePen icon** to drag-select an area
- **Right-click the icon** for **Capture visible area**, **Capture full page**, **Edit screenshot from clipboard**, or **Edit image from file**
- Or use `Alt+Shift+S` / `Alt+Shift+A` (`Option` on a Mac)
- Pick a tool, annotate, then **Copy** or **Download**

## Tests
Plain Node tests, no dependencies. Run from the repo root:

```sh
for f in tests/*.test.js; do node "$f"; done
```

They cover text wrapping, the text box, line geometry and dragging, which objects stay editable, and the Clear all check. UI behaviour is checked by hand in Chrome.

## Notes on permissions
- `activeTab`: capture the current tab only when you click the extension
- `scripting`: inject the area-select overlay / full-page scroll-and-stitch script on demand
- `storage`: temporarily hold the captured image (session-only) while the editor tab loads
- `downloads`: save the edited image to your computer
- `contextMenus`: power the right-click menu on the toolbar icon
- `clipboardRead`: load a screenshot from the clipboard when you choose "Edit screenshot from clipboard"

No analytics, no external servers, no data collection.
