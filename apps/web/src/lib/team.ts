// The people behind Dropzy, for the About page and the "Meet the makers" line in the top bar.
// Photos live in public/team so they load from our own domain (the CSP allows no other).

export type Maker = {
  name: string;
  role: string;
  bio: string;
  photo: string;
  links: { github?: string; linkedin?: string; x?: string };
};

export const TEAM: Maker[] = [
  {
    name: 'Hassam Ali',
    role: 'Founder',
    bio: 'Designs and builds Dropzy, from the servers to the screens.',
    photo: '/team/hassam-ali.jpg',
    links: { github: 'https://github.com/Hassamalidev' },
  },
  {
    name: 'Daniyal Ali Dana',
    role: 'Marketing',
    bio: 'Spreads the word so Dropzy reaches the people who need it.',
    photo: '/team/daniyal-ali-dana.jpg',
    links: {
      linkedin: 'https://www.linkedin.com/in/daniyalalidana/',
      x: 'https://x.com/DaniyalDana',
      github: 'https://github.com/daniyalalidana',
    },
  },
  {
    name: 'Fayaz Hussain Sangeen',
    role: 'Marketing',
    bio: 'Shares Dropzy with the communities and people it can help.',
    photo: '/team/fayaz-hussain-sangeen.jpg',
    links: {
      linkedin: 'https://www.linkedin.com/in/fayaz-hussain-sangeen-80b925396',
      x: 'https://x.com/Fayaz05_eng',
      github: 'https://github.com/fayazhussainsangeen',
    },
  },
  {
    name: 'Ali Zaman',
    role: 'Marketing',
    bio: 'Tells people about Dropzy and brings their feedback back to us.',
    photo: '/team/ali-zaman.jpg',
    links: {
      linkedin: 'https://www.linkedin.com/in/ali-zaman-5a279525b',
      github: 'https://github.com/ali786-hub',
    },
  },
  {
    name: 'Umer Leghari',
    role: 'Marketing',
    bio: 'Helps new people find Dropzy online.',
    photo: '/team/umer-leghari.jpg',
    links: {
      x: 'https://x.com/ummarleghariii',
      github: 'https://github.com/Umar-O-Yaar',
    },
  },
];

/** The founder leads everywhere: first, biggest, in front. Everyone else helps. */
export const FOUNDER = TEAM.find((m) => m.role === 'Founder') as Maker;
export const HELPERS = TEAM.filter((m) => m !== FOUNDER);
