const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const Z = 640 / 350;
let R = 1;
let T = 0;
let C = 0;

function draw() {
    const X = R * Math.cos(T) * Z + 320;
    const Y = R * Math.sin(T) + 175;
    
    // Setting the color
    ctx.fillStyle = `hsl(${C * 22.5}, 100%, 50%)`; // 16 colors in a HSL wheel
    ctx.fillRect(X, Y, 1, 1); // Drawing a single pixel

    C = (C + 1) % 16;
    T += 0.1;
    R *= 1.001;

    if (R < 200) {
        requestAnimationFrame(draw);
    }
}

draw();
