import '../styles/home.css';

interface CardData {
  icon: string;
  title: string;
  description: string;
  href: string;
}

const CARDS: CardData[] = [
  {
    icon: '\u{1F9E9}',
    title: 'Create Puzzle',
    description:
      'Generate tilings with Hat or Spectre tiles, select a region, and create a puzzle to share.',
    href: '/create.html',
  },
  {
    icon: '\u{1F3AF}',
    title: 'Solve Puzzle',
    description:
      'Import a puzzle JSON file and drag, rotate, and snap pieces to complete it.',
    href: '/solve.html',
  },
];

const ABOUT_TEXT =
  'The Einstein problem asks whether a single shape can tile the plane without ever repeating a pattern — a property called aperiodicity. In 2023, the "Hat" tile was discovered as the first such aperiodic monotile, soon followed by the "Spectre" tile, which achieves aperiodicity without reflections. This game lets you explore these fascinating shapes hands-on.';

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  textContent?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (textContent !== undefined) el.textContent = textContent;
  return el;
}

function buildNavCard(data: CardData): HTMLAnchorElement {
  const card = document.createElement('a');
  card.className = 'nav-card';
  card.href = data.href;

  const icon = createElement('div', 'nav-card-icon', data.icon);
  const title = createElement('div', 'nav-card-title', data.title);
  const desc = createElement('div', 'nav-card-desc', data.description);

  card.appendChild(icon);
  card.appendChild(title);
  card.appendChild(desc);

  return card;
}

function buildPage(): HTMLElement {
  const container = createElement('div', 'home-container');

  const hero = createElement('section', 'hero');
  const heroTitle = createElement('h1', 'hero-title', 'Spectre Puzzle');
  const heroSubtitle = createElement('p', 'hero-subtitle', 'An Aperiodic Tiling Puzzle Game');
  hero.appendChild(heroTitle);
  hero.appendChild(heroSubtitle);

  const navCards = createElement('div', 'nav-cards');
  for (const cardData of CARDS) {
    navCards.appendChild(buildNavCard(cardData));
  }

  const about = createElement('section', 'about-section');
  const aboutTitle = createElement('h2', '', 'About the Einstein Problem');
  const aboutText = createElement('p', '', ABOUT_TEXT);
  about.appendChild(aboutTitle);
  about.appendChild(aboutText);

  container.appendChild(hero);
  container.appendChild(navCards);
  container.appendChild(about);

  return container;
}

const app = document.getElementById('app');
if (app) {
  app.appendChild(buildPage());
}
