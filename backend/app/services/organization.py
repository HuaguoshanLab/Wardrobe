"""Read-only suggestions and current decisions from a single database snapshot."""

from typing import cast
from uuid import UUID

from sqlalchemy import select

from app.db.organization import OrganizationDecision
from app.db.session import session_factory
from app.schemas.organization import (
    Candidate,
    DecisionState,
    OrganizationView,
    Shortage,
    SourceView,
)
from app.services.organization_context import context
from app.services.supply_counts import planned_counts


def read(
    state: str, cursor: str | None, limit: int, garment_id: UUID | None = None
) -> OrganizationView:
    with session_factory()() as db:
        db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        ctx = context(db)
        decisions = {
            (r.garment_id, r.reason_key): r for r in db.scalars(select(OrganizationDecision))
        }
        planned = planned_counts(db)
        shortages = []
        for view in ctx.views:
            rows = {r.id: r for r in view.plan.rows}
            for c in view.counts:
                if c.conclusion == "shortage":
                    shortages.append(
                        Shortage(
                            source=SourceView(
                                id=c.row_id,
                                season=view.plan.season,
                                name=rows[c.row_id].name,
                                active=True,
                            ),
                            difference=c.difference or 0,
                            planned=planned.get(c.row_id, 0),
                            needs_attention=c.needs_attention,
                        )
                    )
        images = {g.id: g for v in ctx.views for g in v.garments}
        candidates = []
        for gid, key in sorted(
            ctx.reasons.keys() | decisions.keys(), key=lambda k: (str(k[0]), k[1])
        ):
            if garment_id is not None and gid != garment_id:
                continue
            sort_key = f"{gid}:{key}"
            if cursor and sort_key <= cursor:
                continue
            g, decision = ctx.garments[gid], decisions.get((gid, key))
            current = (gid, key) in ctx.reasons
            archived = g.deleted_at is not None or g.ownership != "owned" or g.is_demo
            effective = decision.state if decision else "suggested"
            if state == "active" and (
                archived
                or effective in {"keep", "done"}
                or (not current and effective not in {"observe", "pending", "repair"})
            ):
                continue
            if state not in {"active", "all"} and effective != state:
                continue
            image = images.get(gid)
            candidates.append(
                Candidate(
                    garment_id=gid,
                    garment_version=g.version,
                    name=str(g.attributes.get("name") or "未命名单品"),
                    image_url=image.image_url if image else "",
                    reason_key=key,
                    reason=ctx.reasons.get((gid, key)) or (decision.reason if decision else ""),
                    decision_version=decision.version if decision else 0,
                    state=cast(DecisionState, effective),
                    note=decision.note if decision else "",
                    current=current,
                    archived=archived,
                )
            )
            if len(candidates) > limit:
                break
        return OrganizationView(
            shortages=shortages,
            candidates=candidates[:limit],
            stats_at=ctx.views[0].stats_at,
            next_cursor=(
                f"{candidates[limit - 1].garment_id}:{candidates[limit - 1].reason_key}"
                if len(candidates) > limit
                else None
            ),
        )
