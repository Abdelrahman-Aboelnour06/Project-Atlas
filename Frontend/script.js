gsap.registerPlugin(ScrollTrigger);

gsap.set(['#h-label', '#h-title', '#h-sub'], { opacity: 0, y: 22 });
gsap.timeline({ defaults: { ease: 'power3.out' } })
    .to('#h-label', { opacity: 1, y: 0, duration: .85, delay: .3 })
    .to('#h-title', { opacity: 1, y: 0, duration: 1.1 }, '-=.45')
    .to('#h-sub', { opacity: 1, y: 0, duration: .85 }, '-=.65');

ScrollTrigger.create({ 
    trigger: '.marquee-wrap', 
    start: 'top top', 
    onEnter: () => document.getElementById('nav').classList.add('compact'), 
    onLeaveBack: () => document.getElementById('nav').classList.remove('compact') 
});

const ioHead = new IntersectionObserver(entries => { 
    entries.forEach(e => { 
        if (e.isIntersecting) { 
            e.target.classList.add('in'); 
            ioHead.unobserve(e.target); 
        } 
    }); 
}, { threshold: .2 });

['sec-head', 'scrub-label'].forEach(id => { 
    const el = document.getElementById(id); 
    if (el) ioHead.observe(el); 
});

const ioCard = new IntersectionObserver(entries => {
    entries.forEach(e => {
        if (!e.isIntersecting) return;
        const card = e.target;
        const delay = (parseInt(card.dataset.delay) || 0) * 110;
        setTimeout(() => { 
            card.classList.add('entering'); 
            requestAnimationFrame(() => card.classList.add('in')); 
        }, delay);
        ioCard.unobserve(card);
    });
}, { threshold: .07 });

document.querySelectorAll('.card').forEach(c => ioCard.observe(c));

function initScrub() {
    const body = document.getElementById('scrub-body');
    if (!body) return;
    const raw = body.textContent.trim();
    body.innerHTML = raw.split(/\s+/).map(w => `<span class="sw">${w} </span>`).join('');
    gsap.to('.sw', { 
        opacity: 1, 
        stagger: { each: .06, from: 'start' }, 
        scrollTrigger: { trigger: '#insight', start: 'top 78%', end: 'bottom 22%', scrub: 2 } 
    });
}

// Dark mode toggle
(function() {
    const toggleBtn = document.getElementById('dark-toggle');
    const body = document.body;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const storedPref = localStorage.getItem('dark-mode');
    let isDark = storedPref !== null ? storedPref === 'true' : prefersDark;

    function applyDarkMode(enable) {
        if (enable) body.classList.add('dark-mode');
        else body.classList.remove('dark-mode');
    }

    applyDarkMode(isDark);

    toggleBtn.addEventListener('click', () => {
        isDark = !body.classList.contains('dark-mode');
        applyDarkMode(isDark);
        localStorage.setItem('dark-mode', isDark);
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (localStorage.getItem('dark-mode') === null) applyDarkMode(e.matches);
    });
})();

window.addEventListener('load', () => { 
    initScrub(); 
    ScrollTrigger.refresh(); 
});