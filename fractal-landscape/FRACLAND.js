// Port of FRACLAND.COM (Copyright 1987 Compute! Publications, Inc.)
//
// FRACLAND.BAS only POKEs machine code into FRACLAND.COM - the real program
// is an 8086 binary. This is a faithful hand-transliteration of that binary,
// produced by disassembling FRACLAND.COM and reconstructing its logic
// instruction-by-instruction (fractal midpoint-displacement heightfield
// generation, an LFSR random number generator seeded from the system clock,
// and a Bresenham-line-based oblique terrain renderer with a per-column
// skyline occlusion buffer, all originally driven through BIOS INT 10h/21h/1Ah).

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const imgData = ctx.createImageData(320, 200);
const textOverlay = document.getElementById('textOverlay');
const hintEl = document.getElementById('hint');

// Default CGA mode 4 palette (palette 1, high intensity): black/cyan/magenta/white
const PALETTE = [
    [0, 0, 0],
    [85, 255, 255],
    [255, 85, 255],
    [255, 255, 255],
];

// ---- 8086 program state, addresses named for what they represent ----

const H = new Int32Array(65 * 65);   // heightfield grid, addr 0x3b1 in the original
const E1 = new Int32Array(320);      // per-column skyline occlusion buffer, addr 0x131

let rngState = 0;                    // addr 0x12d
let drawColor = 0;                   // addr 0x103
let sideFlag = 0;                    // addr 0x105

function Hget(row, col) { return H[row * 65 + col]; }
function Hset(row, col, v) { H[row * 65 + col] = v; }

// ---- Random number generator: an 8-round LFSR, exactly as in the binary ----

function lfsrNext() {
    let ax = rngState & 0xffff;
    for (let i = 0; i < 8; i++) {
        const bit1 = (ax >> 1) & 1;
        const bit2 = (ax >> 2) & 1;
        const carry = bit1 ^ bit2;
        ax = ((ax >>> 1) | (carry << 15)) & 0xffff;
    }
    rngState = ax;
    return ax;
}

function seedRng() {
    // Emulates INT 1Ah AH=0 (read system tick count) feeding the seed routine
    // at 0x4d57, which runs the same 8-round LFSR munge once before use.
    const dx = (Date.now() ^ Math.floor(performance.now() * 1000)) & 0xffff;
    rngState = dx;
    lfsrNext();
}

function randomScaled(range) {
    const raw = lfsrNext();
    const masked = raw & (range - 1);
    const raw2 = lfsrNext();
    return (raw2 & 0xff) >= 0x7f ? masked : -masked;
}

// ---- Framebuffer (emulates INT 10h AH=0Ch write-pixel into CGA mode 4) ----

function clearFramebuffer() {
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
        d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 255;
    }
}

function setPixel(x, y, colorIndex) {
    if (x < 0 || x >= 320 || y < 0 || y >= 200) return;
    const c = PALETTE[colorIndex & 3];
    const off = (y * 320 + x) * 4;
    imgData.data[off] = c[0];
    imgData.data[off + 1] = c[1];
    imgData.data[off + 2] = c[2];
    imgData.data[off + 3] = 255;
}

function present() {
    ctx.putImageData(imgData, 0, 0);
}

// ---- DrawLine: Bresenham line draw with skyline occlusion (sub 0x4bcf) ----

function drawLine(x1, y1, x2, y2) {
    let Y1 = 199 - y1;
    let Y2 = 199 - y2;
    let X1 = x1;
    let X2 = x2;
    const dx = X2 - X1; // computed from the un-swapped inputs, as in the original
    let dir;
    if (Y1 < Y2) {
        [Y1, Y2] = [Y2, Y1];
        [X1, X2] = [X2, X1];
        dir = -1;
    } else {
        dir = 1;
    }
    const dY = Y1 - Y2;
    const xdir = -1;
    let steep = false;
    let minor = dY, major = dx;
    if (dY > dx) {
        steep = true;
        major = dY;
        minor = dx;
    }
    const e1step = 2 * minor;
    const e2step = 2 * (minor - major);
    let err = e1step - major;
    let n = major + 1;

    while (n > 0) {
        if (X1 >= 0 && X1 < 320 && Y1 < E1[X1]) {
            E1[X1] = Y1;
            if (!(drawColor === 3 && sideFlag !== 0)) {
                setPixel(X1, Y1, drawColor);
            }
        }
        if (steep) Y1 += xdir; else X1 += dir;
        if (err >= 0) {
            err += e2step;
            if (steep) X1 += dir; else Y1 += xdir;
        } else {
            err += e1step;
        }
        n--;
    }
}

// ---- Phase 1: recursive square/midpoint-displacement heightfield (0x460f) ----

function generateHeightfield() {
    H.fill(0);
    let step = 64;
    while (step >= 2) {
        let I = 0, INEXT = step;
        while (INEXT <= 64) {
            let J = 0, JNEXT = step;
            const MIDROW = Math.trunc((I + INEXT) / 2);
            while (JNEXT <= 64) {
                const MIDCOL = Math.trunc((J + JNEXT) / 2);

                // top edge midpoint
                let disp = randomScaled(step);
                Hset(I, MIDCOL, Math.trunc((Hget(I, J) + Hget(I, JNEXT)) / 2) + disp);

                // bottom edge midpoint
                disp = randomScaled(step);
                Hset(INEXT, MIDCOL, Math.trunc((Hget(INEXT, J) + Hget(INEXT, JNEXT)) / 2) + disp);

                // left edge midpoint (skipped at the grid's left boundary)
                if (J !== 0) {
                    disp = randomScaled(step);
                    Hset(MIDROW, J, Math.trunc((Hget(I, J) + Hget(INEXT, J)) / 2) + disp);
                }

                // right edge midpoint
                disp = randomScaled(step);
                Hset(MIDROW, JNEXT, Math.trunc((Hget(I, JNEXT) + Hget(INEXT, JNEXT)) / 2) + disp);

                // center, picking one of the two corner diagonals at random
                const useDiagA = (lfsrNext() & 1) === 1;
                let center;
                if (useDiagA) {
                    disp = randomScaled(step);
                    center = Math.trunc((Hget(I, J) + Hget(INEXT, JNEXT) + 3 * disp) / 2);
                } else {
                    disp = randomScaled(step);
                    center = Math.trunc((Hget(I, JNEXT) + Hget(INEXT, J) + 3 * disp) / 2);
                }
                Hset(MIDROW, MIDCOL, center);

                J += step; JNEXT += step;
            }
            I += step; INEXT += step;
        }
        step = step >> 1;
    }
}

// ---- Phase 1.5: 3-point vertical smoothing pass (0x4847) ----

function smoothHeightfield() {
    for (let col = 0; col <= 64; col++) {
        for (let row = 1; row < 64; row++) {
            Hset(row, col, Math.trunc((Hget(row - 1, col) + Hget(row + 1, col) + Hget(row, col)) / 3));
        }
    }
}

// ---- Phase 2 setup: frame border (0x48a9) ----

function initE1() {
    E1.fill(200);
}

function drawBorderBox() {
    drawColor = 3;
    sideFlag = 0;
    drawLine(0, 1, 0, 199);
    drawLine(316, 1, 316, 199);
    drawLine(0, 1, 316, 1);
    drawLine(0, 199, 316, 199);
}

// ---- Phase 3: main oblique terrain sweep (0x491b) ----

function renderColumn(R) {
    for (let S = 0; S <= 1; S++) {
        sideFlag = S;
        if (R === 64 && S !== 0) continue;

        let F1 = 0;
        let F2 = true;
        let prevX = 0, prevY = 0;

        for (let C = 0; C < 64; C++) {
            let slope5 = 5 * C;

            if (C !== 0 && C !== 63 && R !== 64) {
                if (S !== 0) {
                    const sumAbove = Hget(C - 1, R + 1) + Hget(C - 1, R);
                    const sumCur = Hget(C, R + 1) + Hget(C, R);
                    if (sumAbove > 0 && sumCur < 0) {
                        slope5 += Math.trunc((5 * sumCur) / (sumAbove - sumCur));
                    } else {
                        const sumBelow = Hget(C + 1, R + 1) + Hget(C + 1, R);
                        if (sumBelow > 0 && sumCur < 0) {
                            slope5 += Math.trunc((5 * sumCur) / (sumCur - sumBelow));
                        }
                    }
                } else {
                    const above = Hget(C - 1, R);
                    const cur = Hget(C, R);
                    if (above > 0 && cur < 0) {
                        slope5 += Math.trunc((5 * cur) / (above - cur));
                    } else {
                        const below = Hget(C + 1, R);
                        if (below > 0 && cur < 0) {
                            slope5 += Math.trunc((5 * cur) / (cur - below));
                        }
                    }
                }
            }

            let v123 = S !== 0
                ? Math.trunc((Hget(C, R) + Hget(C, R + 1)) / 2)
                : Hget(C, R);
            if (v123 < 0) v123 = 0;

            drawColor = (v123 === 0 && F1 === 0) ? 1 : 3;
            F1 = v123;

            let curX = slope5;
            let curY = R * 2 + S + v123 + 1;

            if (F2) {
                curX = 1;
                prevX = 1;
                prevY = curY;
                F2 = false;
            }

            if (!(R === 0 && S === 0)) {
                drawLine(prevX, prevY, curX, curY);
            }

            prevX = curX;
            prevY = curY;
        }
    }
}

// ---- Phase 4: fill beneath the horizon (0x4b89) ----

function groundFill() {
    drawColor = 2;
    for (let v = 0x81; v < 0xc7; v++) {
        drawLine(1, v, 315, v);
    }
}

// ---- UI plumbing ----

function showText(msg) {
    textOverlay.textContent = msg;
    textOverlay.classList.remove('hidden');
}
function hideText() {
    textOverlay.classList.add('hidden');
}
function setHint(msg) {
    hintEl.textContent = msg;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function waitForKey() {
    return new Promise((resolve) => {
        function onKey(e) {
            window.removeEventListener('keydown', onKey);
            canvas.removeEventListener('click', onClick);
            resolve(e.key.toLowerCase());
        }
        function onClick() {
            window.removeEventListener('keydown', onKey);
            canvas.removeEventListener('click', onClick);
            resolve('');
        }
        window.addEventListener('keydown', onKey);
        canvas.addEventListener('click', onClick);
    });
}

async function main() {
    seedRng(); // seeded once from the clock, exactly as the original does at startup

    while (true) {
        setHint('');
        showText('Computing elevations...');
        initE1();
        generateHeightfield();
        smoothHeightfield();
        await sleep(400);

        hideText();
        clearFramebuffer();
        initE1();
        drawBorderBox();
        initE1();
        present();

        for (let R = 0; R <= 64; R++) {
            renderColumn(R);
            present();
            await sleep(12);
        }

        groundFill();
        present();

        setHint('Press any key (or click) for a new landscape — Q to quit');
        const key = await waitForKey();
        if (key === 'q') {
            clearFramebuffer();
            present();
            setHint('(program ended — reload the page to run again)');
            break;
        }
    }
}

main();
