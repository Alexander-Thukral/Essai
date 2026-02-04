export const INITIAL_TAGS = [
  "Psychology", "Physics", "Biology", "Mathematics", 
  "Computer Science", "Philosophy", "Essays", 
  "Sociology", "Game Theory", "Economics", "Geopolitics", "History"
];

export const MOCK_ARTICLES = [
  {
    id: "mock-1",
    title: "The Use of Knowledge in Society",
    author: "Friedrich Hayek",
    url: "https://www.econlib.org/library/Essays/hykKnw.html",
    description: "A seminal economic paper arguing that the central economic problem is not resource allocation, but how to secure the best use of resources known to any of the members of society, for ends whose relative importance only these individuals know.",
    reason: "Connects deeply with your interest in distributed systems and economic thinking.",
    tags: ["Economics", "Philosophy", "Complex Systems"],
    dateAdded: new Date(Date.now() - 86400000 * 2).toISOString(),
    read: true,
    rating: 5,
    isVerified: true
  },
  {
    id: "mock-2",
    title: "Politics and the English Language",
    author: "George Orwell",
    url: "https://www.orwellfoundation.com/the-orwell-foundation/orwell/essays-and-other-works/politics-and-the-english-language/",
    description: "Orwell critiques the 'ugly and inaccurate' written English of his time and examines the connection between political orthodoxies and the debasement of language.",
    reason: "A classic essay on writing and thought, fitting your interest in literary nonfiction.",
    tags: ["Essays", "Politics", "Language"],
    dateAdded: new Date(Date.now() - 86400000).toISOString(),
    read: false,
    rating: undefined,
    isVerified: true
  }
];

export const SYSTEM_INSTRUCTION = `You are a sophisticated reading recommendation engine for an intellectual user with broad, multidisciplinary interests (Psychology, Hard Sciences, Philosophy, Game Theory, Econ, etc.). 
Your goal is to surface "obscure gems", philosophically rich essays, and unexpected connections. 
Avoid generic "Top 10" lists. Prioritize depth, originality, and high-quality writing.
You must return a SINGLE reading recommendation in JSON format.
Ensure the article exists and is likely accessible online (not behind a hard paywall if possible).
`;