// Pink Cow — question pack
// Each entry is a string. Add your own to CUSTOM_QUESTIONS at the bottom.
// Questions are designed for crowd-thinking: there should be a few obvious
// popular answers so players can try to match the herd.

const QUESTIONS = [
  // Animals & nature
  "Name a farm animal",
  "Name a big cat",
  "Name a sea creature",
  "Name a bird that can't fly",
  "Name something you'd find in a garden",
  "Name a type of dog",
  "Name a jungle animal",
  "Name something a bear does in winter",
  "Name an animal known for being slow",
  "Name an animal that lives in cold places",

  // Food & drink
  "Name a pizza topping",
  "Name a sandwich filling",
  "Name a flavour of ice cream",
  "Name a fruit you'd find in a fruit bowl",
  "Name something you'd put on toast",
  "Name a type of pasta",
  "Name a fast food restaurant",
  "Name something people drink at breakfast",
  "Name a vegetable kids hate",
  "Name a snack you'd eat at the cinema",
  "Name something you'd put in a salad",
  "Name a type of cheese",
  "Name a condiment",
  "Name a food that's always at a BBQ",

  // Pop culture & entertainment
  "Name a superhero",
  "Name a Disney princess",
  "Name a board game",
  "Name a popular video game",
  "Name something you'd find in a toy box",
  "Name a TV show everyone has seen",
  "Name a sport played with a ball",
  "Name a card game",
  "Name something you do on a rainy day",
  "Name a streaming service",

  // Everyday life
  "Name something in a bathroom cabinet",
  "Name something you do first thing in the morning",
  "Name a reason you'd call in sick",
  "Name something you'd find in a handbag",
  "Name a reason to set an alarm",
  "Name something people argue about at home",
  "Name something you always lose",
  "Name something you do on your phone",
  "Name a chore most people hate",
  "Name something you'd see in an office",
  "Name something you buy at a petrol station",
  "Name something in a junk drawer",

  // Places & travel
  "Name a holiday destination",
  "Name a type of transport",
  "Name a country in Europe",
  "Name something you pack in a suitcase",
  "Name a famous landmark",
  "Name a city known for its food",

  // Random & fun
  "Name something that is always red",
  "Name something you'd find at a wedding",
  "Name a reason someone might cry",
  "Name something you'd see at a circus",
  "Name something that belongs in a museum",
  "Name a job that didn't exist 20 years ago",
  "Name a word that rhymes with 'cat'",
  "Name something associated with luck",
  "Name a thing you do when you're bored",
  "Name something people collect",
  "Name something you'd find under a bed",
  "Name something that makes a loud noise",
];

// Add your own custom questions here — they'll be shuffled in with the rest.
const CUSTOM_QUESTIONS = [
  // "Name something you'd find on the moon",
  // "Name a reason to throw a party",
];

module.exports = { QUESTIONS: [...QUESTIONS, ...CUSTOM_QUESTIONS] };
