---
'@quill/web': patch
---

The API skill says which step type to use for each kind of question.

`SKILL.md` gains a "Step types" table, and the quiz recipe now asks for the person's name with a `name` step before the email. In the end-to-end test of the API with the skill, a smaller model asked for the name with a `text` step in three of its four quiz runs, because nothing in the skill said that `name` exists for that. dForms titles each response after its `name` step, so those quizzes collected leads without a name. With this change it used `name` in four runs out of four.
