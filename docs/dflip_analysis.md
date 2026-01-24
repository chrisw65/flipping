# dFlip Reference Analysis (dflip.min.js)

Date: 2026-01-24

This document summarizes how dFlip handles page meshes, textures, UVs, and page assignment, and maps those behaviors to our current flipbook implementation. It also records what was changed after the last commit, why the behavior regressed, and how we will proceed differently.

---

## 1) dFlip: What It Actually Does (from `reference/dflip.min.js`)

### 1.1 Page mesh / materials
**Search tokens in `reference/dflip.min.js`:**
- `baseType="Paper"`
- `MATERIAL_FACE:{FRONT:5,BACK:4}`
- `frontImage` / `backImage`

**Observed behavior:**
- dFlip creates a page mesh using **THREE.BoxGeometry** with a material array of length 6.
- It uses **material index 5 for FRONT** and **material index 4 for BACK**.
- Front and back textures are assigned **only** via `frontImage()` and `backImage()` calls, which load textures into material 5 and 4 respectively.

**Implication:**
- dFlip does **not** swap the back texture based on drag position or under pages. It treats front/back as fixed page faces for the sheet.

### 1.2 UV mapping during curl
**Search token:** `faceVertexUvs[0]`

**Observed behavior (key logic in the UV update loop):**
- For **BACK faces** (material 4): `u = d[F] / c`
- For **FRONT faces** (material 5): `u = 1 - d[F] / c`

**Implication:**
- UV orientation is driven strictly by material face (front vs back), not by page side, not by angle thresholds, and not by mirrored geometry.

### 1.3 Front/back page assignment per sheet
**Search token:** `refreshSheet`

**Observed behavior:**
- On sheet refresh, dFlip assigns **frontPage.pageNumber** and **backPage.pageNumber** once, based on the sheet index `d`:
  - `frontPage.pageNumber = 2*d + 1`
  - `backPage.pageNumber = 2*d + 2`
  (RTL and booklet modes swap or adjust, but the assignment is still fixed per sheet.)
- Textures are then loaded for those page numbers through the viewer pipeline.

**Implication:**
- dFlip keeps **two distinct page objects** per sheet with fixed page numbers. It does not re-map faces per drag frame.

### 1.4 Texture lifecycle
**Search token:** `resetTexture`

**Observed behavior:**
- When a sheet is re-used or its page number changes, dFlip calls `resetTexture()` and requests new textures via the viewer’s texture pipeline (`setPage` / `loadTexture`).

**Implication:**
- dFlip’s texture mapping is **stable and deterministic**, not dependent on drag state.

---

## 2) Mapping dFlip behavior to our implementation

**dFlip behavior** | **Current implementation** | **Action**
---|---|---
Front/back faces are fixed per sheet | We swapped back textures based on under pages | Stop swapping back textures based on under pages
UVs: front uses `1 - u`, back uses `u` | We used pageSide-based UV mirroring | Use material-based UV mapping only
Two page objects per sheet (front/back) | We treat turning page as a single page and swap textures | Keep front/back textures fixed per sheet; use separate under meshes for underlying pages

---

## 3) What changed after the last commit (and why it regressed)

After the last commit, we made several changes attempting to fix drag/under-page issues, but they diverged from dFlip behavior. Summary of those changes:

### 3.1 Rendering / geometry
- **Switched between single-mesh and split front/back meshes** multiple times.
- Tried **DoubleSide** materials to avoid culling, which caused **multiple textures showing at once** in the curl.
- Added page-side mirroring and UV flips, which **broke left page rendering** and caused pages to disappear after the spine.

### 3.2 Texture assignment
- **Back textures were repeatedly swapped** to show under pages during drag.
- This created **mixed textures** within the curl and inconsistent mapping after crossing the spine.

### 3.3 Performance & caching
- Added under-page prefetch and cache-window logic.
- Added a low-res -> high-res swap for the active spread.
- Added perf overlay and cache stats.

**Net effect:**
- Drag behavior improved temporarily, but **page mapping after the spine became incorrect** and pages disappeared. The changes did not match dFlip’s fixed face mapping.

---

## 4) Recommendations (dFlip-aligned)

### 4.1 Texture mapping (highest priority)
- **Do not swap back textures** based on under pages during drag.
- The back face of the turning page should always be the **next page in that sheet** (fixed front/back mapping).
- Under pages should be separate meshes only.

### 4.2 UV mapping (second priority)
- Use the **dFlip UV rule** only:
  - `uFront = 1 - uArc`
  - `uBack = uArc`
- No pageSide-dependent flipping or angle-based switches.

### 4.3 Geometry / culling
- dFlip uses **BoxGeometry** with **material indices 4 and 5** for back/front.
- If we keep our custom geometry, we must ensure **front/back faces are distinct** and culling is correct without using DoubleSide.
- If mirroring the mesh for left pages, **do not** invert UV logic — instead rotate/position the sheet like dFlip.

### 4.4 Under pages
- Under pages should be **independent meshes** with their own textures.
- The turning page should never “borrow” the under page texture for its back face.

### 4.5 Performance
- Keep prefetch/caching, but isolate it from page-face mapping.
- Performance improvements must not alter which textures appear on the page faces.

---

## 5) How we will proceed differently (to rebuild trust)

1) **No code changes without written mapping**
   - Each change must point to the dFlip behavior above.

2) **One change at a time**
   - Each change is isolated and reversible.

3) **No new guesses**
   - Only behavior observed in `reference/dflip.min.js` is used.

4) **You approve before edits**
   - I will propose the minimal patch, you approve, then I apply.

---

## 6) Immediate next step (proposed)

**Goal:** Fix page mapping after the spine while keeping drag behavior.

**Proposed minimal change:**
- Remove all back-texture swapping based on under pages.
- Lock turning page back texture to the fixed page number (front/back mapping), and keep under pages separate.

This matches dFlip’s behavior directly.

---

## Appendix: dFlip search tokens

Use these exact tokens in `reference/dflip.min.js` to verify behavior:
- `baseType="Paper"`
- `MATERIAL_FACE:{FRONT:5,BACK:4}`
- `frontImage`
- `backImage`
- `faceVertexUvs[0]`
- `refreshSheet`
- `resetTexture`

