// Steampunk Boardgame Portal Logic

// SOUND SYNTHESIS ENGINE (Web Audio API)
const PortalSynth = {
    ctx: null,
    
    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    },
    
    playTick() {
        this.init();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(450, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(10, this.ctx.currentTime + 0.08);
        
        gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start();
        osc.stop(this.ctx.currentTime + 0.08);
    },
    
    playValve() {
        this.init();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = 'square';
        osc.frequency.setValueAtTime(120, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(5, this.ctx.currentTime + 0.15);
        
        gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start();
        osc.stop(this.ctx.currentTime + 0.15);
    }
};

// Canvas ambient steam particles
const canvas = document.getElementById('steam-canvas');
const ctx = canvas.getContext('2d');

let particles = [];

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

class SteamParticle {
    constructor() {
        this.x = Math.random() * canvas.width;
        this.y = canvas.height + Math.random() * 50;
        this.vx = (Math.random() - 0.5) * 0.5;
        this.vy = -(0.5 + Math.random() * 1.2);
        this.radius = 15 + Math.random() * 45;
        this.alpha = 0.02 + Math.random() * 0.12;
        this.decay = 0.0004 + Math.random() * 0.001;
    }
    
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.alpha -= this.decay;
    }
    
    draw() {
        ctx.beginPath();
        const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius);
        grad.addColorStop(0, `rgba(245, 238, 220, ${this.alpha})`);
        grad.addColorStop(1, 'rgba(245, 238, 220, 0)');
        ctx.fillStyle = grad;
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Spawn particles randomly
    if (particles.length < 45 && Math.random() < 0.15) {
        particles.push(new SteamParticle());
    }
    
    particles.forEach((p, idx) => {
        p.update();
        if (p.alpha <= 0) {
            particles.splice(idx, 1);
        } else {
            p.draw();
        }
    });
    
    requestAnimationFrame(animate);
}

animate();

// Game Card selection redirection
window.selectGame = function(url) {
    PortalSynth.playTick();
    setTimeout(() => {
        window.location.href = url;
    }, 150);
};

// Hook mouse hovers on game cards to play sound
document.addEventListener('DOMContentLoaded', () => {
    const activeCards = document.querySelectorAll('.active-game');
    const lockedCards = document.querySelectorAll('.locked-game');
    
    activeCards.forEach(c => {
        c.addEventListener('mouseenter', () => {
            PortalSynth.playValve();
        });
    });
    
    lockedCards.forEach(c => {
        c.addEventListener('mouseenter', () => {
            // subtle dull tick for locked
            PortalSynth.init();
            const osc = PortalSynth.ctx.createOscillator();
            const gain = PortalSynth.ctx.createGain();
            osc.frequency.setValueAtTime(60, PortalSynth.ctx.currentTime);
            gain.gain.setValueAtTime(0.02, PortalSynth.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, PortalSynth.ctx.currentTime + 0.05);
            osc.connect(gain);
            gain.connect(PortalSynth.ctx.destination);
            osc.start();
            osc.stop(PortalSynth.ctx.currentTime + 0.05);
        });
    });
});
