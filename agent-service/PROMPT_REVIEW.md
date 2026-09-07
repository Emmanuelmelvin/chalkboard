# Model policy review gates

`SYSTEM_INFO.md` is the model-facing authority policy. It is intentionally
separate from implementation documentation and is loaded only from the
packaged agent-service directory.

Every policy, prompt-compiler, tool-description, or delivery change must pass
these gates before release:

1. **Authority mapping:** reviewers map each safety, permission, destructive
   action, and delivery rule to the code that enforces it. Model instructions
   alone do not enforce permissions.
2. **Contract tests:** run `python -m pytest agent-service/tests -q`. The
   prompt-contract tests verify the policy version/hash, template-free policy,
   bounded JSON context, data minimization, and trusted delivery envelope.
3. **Adversarial evaluation:** add cases for prompt injection in room metadata,
   names, chat, and history; viewer mutation attempts; destructive actions;
   duplicate delivery; and voice-unavailable fallbacks. Record the expected
   tool calls and emitted socket events.
4. **Sandbox integration:** run the changed scenarios against a disposable
   room. Assert board state and emitted events, not only model prose.
5. **Observability:** release telemetry must include policy version/hash,
   model/provider, prompt character count, tool attempts/outcomes, delivery
   channel, cancellations, and context truncation counts. Do not log raw
   classroom content by default.
6. **Promotion:** deploy to staging, run the evaluation suite, then canary the
   immutable policy version. Promote only if delivery, tool-error, permission-
   denial, and latency metrics stay within the agreed baseline. Keep the prior
   policy artifact available for immediate rollback.

Changes to the policy require product and security review when they expand
permissions, change data sent to a provider, alter destructive-action handling,
or change a response channel.
