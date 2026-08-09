// =============================================================
// Albert Nunes Dias — Portfólio Profissional (interativo)
// =============================================================

(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  document.addEventListener('DOMContentLoaded', () => {

    // ---- Ano dinâmico no rodapé ----
    const yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    // =========================================================
    // BOOT LOADER
    // =========================================================
    const bootLoader = document.getElementById('bootLoader');
    const bootText = document.getElementById('bootText');
    const bootBarFill = document.getElementById('bootBarFill');
    const bootMessage = 'inicializando portfolio.exe';

    if (bootLoader) {
      document.body.style.overflow = 'hidden';

      if (reduceMotion) {
        bootLoader.classList.add('hidden');
        document.body.style.overflow = '';
      } else {
        let i = 0;
        const typeBoot = () => {
          if (i <= bootMessage.length) {
            bootText.textContent = bootMessage.slice(0, i);
            i++;
            setTimeout(typeBoot, 26);
          } else {
            requestAnimationFrame(() => { bootBarFill.style.width = '100%'; });
            setTimeout(() => {
              bootLoader.classList.add('hidden');
              document.body.style.overflow = '';
            }, 1000);
          }
        };
        setTimeout(typeBoot, 200);
      }
    }

    // =========================================================
    // MENU MOBILE
    // =========================================================
    const navToggle = document.getElementById('navToggle');
    const mainNav = document.getElementById('mainNav');

    if (navToggle && mainNav) {
      navToggle.addEventListener('click', () => {
        const isOpen = mainNav.classList.toggle('open');
        navToggle.classList.toggle('open', isOpen);
        navToggle.setAttribute('aria-expanded', String(isOpen));
        navToggle.setAttribute('aria-label', isOpen ? 'Fechar menu' : 'Abrir menu');
      });

      mainNav.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', () => {
          mainNav.classList.remove('open');
          navToggle.classList.remove('open');
          navToggle.setAttribute('aria-expanded', 'false');
          navToggle.setAttribute('aria-label', 'Abrir menu');
        });
      });
    }

    // =========================================================
    // FALLBACK DA FOTO
    // =========================================================
    const photo = document.getElementById('profilePhoto');
    const frame = photo ? photo.closest('.photo-frame') : null;
    if (photo && frame) {
      photo.addEventListener('error', () => frame.classList.add('no-photo'));
      if (photo.complete && photo.naturalWidth === 0) frame.classList.add('no-photo');
    }

    // =========================================================
    // TYPEWRITER — cargo rotativo no hero
    // =========================================================
    const typedRole = document.getElementById('typedRole');
    if (typedRole) {
      const phrases = [
        'Gestão da Tecnologia da Informação',
        'Técnico em T.I e Redes de Computadores'
      ];
      if (reduceMotion) {
        typedRole.textContent = phrases[0];
      } else {
        let phraseIndex = 0, charIndex = 0, deleting = false;
        const tick = () => {
          const current = phrases[phraseIndex];
          if (!deleting) {
            charIndex++;
            typedRole.textContent = current.slice(0, charIndex);
            if (charIndex === current.length) {
              deleting = true;
              setTimeout(tick, 1800);
              return;
            }
          } else {
            charIndex--;
            typedRole.textContent = current.slice(0, charIndex);
            if (charIndex === 0) {
              deleting = false;
              phraseIndex = (phraseIndex + 1) % phrases.length;
            }
          }
          setTimeout(tick, deleting ? 28 : 48);
        };
        tick();
      }
    }

    // =========================================================
    // TERMINAL — linhas digitadas
    // =========================================================
    const terminalBody = document.getElementById('terminalBody');
    if (terminalBody) {
      const lines = [
        { cmd: 'whoami', out: 'Albert Nunes Dias' },
        { cmd: 'cat objetivo.txt', out: 'Em busca de crescimento em T.I' },
        { cmd: 'local --info', out: 'Barueri, SP · Brasil' },
        { cmd: 'status', out: 'Disponível para novas oportunidades' }
      ];

      if (reduceMotion) {
        terminalBody.innerHTML = lines
          .map((l) => `<span class="t-cmd">$ ${l.cmd}</span><span class="t-out">${l.out}</span>`)
          .join('');
      } else {
        let lineIdx = 0;
        const renderLine = () => {
          if (lineIdx >= lines.length) return;
          const { cmd, out } = lines[lineIdx];
          const cmdEl = document.createElement('span');
          cmdEl.className = 't-cmd';
          terminalBody.appendChild(cmdEl);
          let c = 0;
          const typeCmd = () => {
            if (c <= cmd.length) {
              cmdEl.textContent = '$ ' + cmd.slice(0, c);
              c++;
              setTimeout(typeCmd, 32);
            } else {
              const outEl = document.createElement('span');
              outEl.className = 't-out';
              outEl.textContent = out;
              terminalBody.appendChild(outEl);
              lineIdx++;
              setTimeout(renderLine, 380);
            }
          };
          typeCmd();
        };
        setTimeout(renderLine, 1400);
      }
    }

    // =========================================================
    // REDE DE PARTÍCULAS (canvas) — hero e experiência
    // =========================================================
    function initNetwork(canvas) {
      if (!canvas || reduceMotion) return;
      const ctx = canvas.getContext('2d');
      let width, height, particles, rafId;
      let mouse = { x: null, y: null };
      let visible = true;

      const DENSITY = 14000; // px² por partícula
      const LINK_DIST = 130;

      function resize() {
        const rect = canvas.parentElement.getBoundingClientRect();
        width = canvas.width = rect.width;
        height = canvas.height = rect.height;
        const count = Math.max(24, Math.min(90, Math.floor((width * height) / DENSITY)));
        particles = Array.from({ length: count }, () => ({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.35,
          vy: (Math.random() - 0.5) * 0.35
        }));
      }

      function step() {
        if (!visible) { rafId = requestAnimationFrame(step); return; }
        ctx.clearRect(0, 0, width, height);

        particles.forEach((p) => {
          p.x += p.vx; p.y += p.vy;
          if (p.x < 0 || p.x > width) p.vx *= -1;
          if (p.y < 0 || p.y > height) p.vy *= -1;
        });

        for (let i = 0; i < particles.length; i++) {
          for (let j = i + 1; j < particles.length; j++) {
            const a = particles[i], b = particles[j];
            const dx = a.x - b.x, dy = a.y - b.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < LINK_DIST) {
              ctx.strokeStyle = `rgba(120,170,255,${0.16 * (1 - dist / LINK_DIST)})`;
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.stroke();
            }
          }
          if (mouse.x !== null) {
            const dx = particles[i].x - mouse.x, dy = particles[i].y - mouse.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 160) {
              ctx.strokeStyle = `rgba(245,124,0,${0.28 * (1 - dist / 160)})`;
              ctx.beginPath();
              ctx.moveTo(particles[i].x, particles[i].y);
              ctx.lineTo(mouse.x, mouse.y);
              ctx.stroke();
            }
          }
        }

        particles.forEach((p) => {
          ctx.fillStyle = 'rgba(180,205,255,0.55)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
          ctx.fill();
        });

        rafId = requestAnimationFrame(step);
      }

      canvas.parentElement.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        mouse.x = e.clientX - rect.left;
        mouse.y = e.clientY - rect.top;
      });
      canvas.parentElement.addEventListener('mouseleave', () => { mouse.x = null; mouse.y = null; });

      document.addEventListener('visibilitychange', () => { visible = !document.hidden; });

      window.addEventListener('resize', resize, { passive: true });
      resize();
      step();
    }

    initNetwork(document.getElementById('networkCanvas'));
    initNetwork(document.getElementById('networkCanvasDark'));

    // =========================================================
    // TILT 3D + SPOTLIGHT nos cards
    // =========================================================
    if (!reduceMotion && window.matchMedia('(hover: hover)').matches) {
      document.querySelectorAll('.tilt-card').forEach((card) => {
        const inner = card.querySelector('.tilt-inner');
        if (!inner) return;
        card.addEventListener('mousemove', (e) => {
          const rect = card.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const cx = rect.width / 2, cy = rect.height / 2;
          const rotateX = ((y - cy) / cy) * -5;
          const rotateY = ((x - cx) / cx) * 5;
          inner.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(4px)`;
          inner.style.setProperty('--sx', `${(x / rect.width) * 100}%`);
          inner.style.setProperty('--sy', `${(y / rect.height) * 100}%`);
        });
        card.addEventListener('mouseleave', () => {
          inner.style.transform = 'rotateX(0deg) rotateY(0deg)';
        });
      });
    }

    // =========================================================
    // BOTÕES MAGNÉTICOS (SUAVIZADO)
    // =========================================================
    if (!reduceMotion && window.matchMedia('(hover: hover)').matches) {
      document.querySelectorAll('.magnetic').forEach((el) => {
        let rafId = null;
        let currentX = 0;
        let currentY = 0;
        let targetX = 0;
        let targetY = 0;
        
        // Anima suavemente usando requestAnimationFrame
        function animate() {
          // Interpolação linear para movimento suave
          currentX += (targetX - currentX) * 0.15;
          currentY += (targetY - currentY) * 0.15;
          
          // Se a diferença for muito pequena, arredonda para evitar micro-vibrações
          if (Math.abs(currentX - targetX) < 0.01 && Math.abs(currentY - targetY) < 0.01) {
            currentX = targetX;
            currentY = targetY;
          }
          
          el.style.transform = `translate(${currentX}px, ${currentY}px)`;
          
          // Continua animando enquanto houver diferença significativa
          if (Math.abs(currentX - targetX) > 0.01 || Math.abs(currentY - targetY) > 0.01) {
            rafId = requestAnimationFrame(animate);
          } else {
            rafId = null;
          }
        }
        
        el.addEventListener('mousemove', (e) => {
          const rect = el.getBoundingClientRect();
          // Calcula o deslocamento baseado na posição do mouse dentro do elemento
          const x = e.clientX - rect.left - rect.width / 2;
          const y = e.clientY - rect.top - rect.height / 2;
          
          // Limita o deslocamento máximo para evitar que o card saia muito do lugar
          const maxOffset = 12;
          const offsetX = Math.max(-maxOffset, Math.min(maxOffset, x * 0.15));
          const offsetY = Math.max(-maxOffset, Math.min(maxOffset, y * 0.15));
          
          targetX = offsetX;
          targetY = offsetY;
          
          // Inicia a animação se não estiver rodando
          if (!rafId) {
            rafId = requestAnimationFrame(animate);
          }
        });
        
        el.addEventListener('mouseleave', () => {
          // Volta à posição original suavemente
          targetX = 0;
          targetY = 0;
          
          if (!rafId) {
            rafId = requestAnimationFrame(animate);
          }
        });
      });
    }
    // =========================================================
    // CONTADORES ANIMADOS (cursos)
    // =========================================================
    const counters = document.querySelectorAll('.counter');
    if (counters.length) {
      const animateCounter = (el) => {
        const target = parseInt(el.dataset.count, 10) || 0;
        if (reduceMotion) { el.textContent = target; return; }
        const duration = 1200;
        const start = performance.now();
        const step = (now) => {
          const progress = Math.min((now - start) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          el.textContent = Math.round(eased * target);
          if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      };

      const counterObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            animateCounter(entry.target);
            counterObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.6 });
      counters.forEach((c) => counterObserver.observe(c));
    }

    // =========================================================
    // LINHA DE PROGRESSO DA TIMELINE (Formação)
    // =========================================================
    const timeline = document.getElementById('timelineFormacao');
    const timelineFill = timeline ? timeline.querySelector('.timeline-fill') : null;
    function updateTimelineFill() {
      if (!timeline || !timelineFill) return;
      const rect = timeline.getBoundingClientRect();
      const vh = window.innerHeight;
      const total = rect.height;
      const visibleStart = vh * 0.8;
      const progressed = Math.min(Math.max(visibleStart - rect.top, 0), total);
      const pct = total > 0 ? (progressed / total) * 100 : 0;
      timelineFill.style.height = `${pct}%`;
    }

    // =========================================================
    // ABAS — Conhecimentos (filtro)
    // =========================================================
    const kTabs = document.querySelectorAll('.k-tab');
    const badges = document.querySelectorAll('.knowledge-badge');
    kTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        kTabs.forEach((t) => { t.classList.remove('is-active'); t.setAttribute('aria-selected', 'false'); });
        tab.classList.add('is-active');
        tab.setAttribute('aria-selected', 'true');
        const filter = tab.dataset.filter;
        badges.forEach((b) => {
          const show = filter === 'all' || b.dataset.cat === filter;
          b.classList.toggle('is-hidden', !show);
        });
      });
    });

    // =========================================================
    // ABAS — Experiência
    // =========================================================
    const expTabs = document.querySelectorAll('.exp-tab');
    const expPanels = document.querySelectorAll('.exp-panel');
    expTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        expTabs.forEach((t) => { t.classList.remove('is-active'); t.setAttribute('aria-selected', 'false'); });
        tab.classList.add('is-active');
        tab.setAttribute('aria-selected', 'true');
        const targetId = tab.dataset.target;
        expPanels.forEach((panel) => {
          const match = panel.id === targetId;
          panel.hidden = !match;
          panel.classList.toggle('is-active', match);
        });
      });
    });

    // =========================================================
    // COPIAR CONTATO
    // =========================================================
    document.querySelectorAll('.copy-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const value = btn.dataset.copy;
        try {
          await navigator.clipboard.writeText(value);
        } catch (e) {
          // Fallback silencioso caso a API de clipboard não esteja disponível
        }
        const original = btn.textContent;
        btn.textContent = 'Copiado!';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = original;
          btn.classList.remove('copied');
        }, 1600);
      });
    });

    // =========================================================
    // REVELAR SEÇÕES AO ROLAR
    // =========================================================
    const revealTargets = document.querySelectorAll(
      '.info-card, .timeline-item, .qual-card, .course-card, .contact-card, .objective-panel, .knowledge-block, .section-head, .exp-tabs'
    );
    revealTargets.forEach((el) => el.classList.add('reveal'));

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('in-view');
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
      );
      revealTargets.forEach((el) => observer.observe(el));
    } else {
      revealTargets.forEach((el) => el.classList.add('in-view'));
    }

    // =========================================================
    // SCROLL: progresso de leitura, timeline, back-to-top, menu ativo
    // =========================================================
    const scrollProgress = document.getElementById('scrollProgress');
    const backToTop = document.getElementById('backToTop');
    const progressRingFill = document.getElementById('progressRingFill');
    const RING_CIRCUMFERENCE = 119.4;

    function onScroll() {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;

      if (scrollProgress) scrollProgress.style.width = `${pct}%`;

      if (backToTop) {
        backToTop.classList.toggle('visible', scrollTop > 480);
      }
      if (progressRingFill) {
        const offset = RING_CIRCUMFERENCE - (pct / 100) * RING_CIRCUMFERENCE;
        progressRingFill.style.strokeDashoffset = offset;
      }

      updateTimelineFill();
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', updateTimelineFill, { passive: true });
    onScroll();

    if (backToTop) {
      backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));
    }

    const sections = document.querySelectorAll('main section[id]');
    const navLinks = document.querySelectorAll('.main-nav a');
    if ('IntersectionObserver' in window && sections.length && navLinks.length) {
      const navObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const id = entry.target.getAttribute('id');
              navLinks.forEach((link) => {
                const isActive = link.getAttribute('href') === `#${id}`;
                link.style.color = isActive ? 'var(--primary)' : '';
              });
            }
          });
        },
        { rootMargin: '-45% 0px -50% 0px' }
      );
      sections.forEach((section) => navObserver.observe(section));
    }
  });
})();
