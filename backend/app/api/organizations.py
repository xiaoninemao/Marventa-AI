from fastapi import APIRouter, Depends, HTTPException

from app.auth.dependencies import get_current_user
from app.auth.models import (
    OrganizationDetail,
    OrganizationDetails,
    OrganizationMember,
    OrganizationMemberInvite,
    OrganizationMemberRole,
    OrganizationName,
    OrganizationResponse,
)
from app.auth.storage import (
    OrganizationMemberNotFound,
    OrganizationMembershipExists,
    OrganizationNotFound,
    OrganizationPermissionDenied,
    create_organization,
    get_organization,
    invite_organization_member,
    list_organization_members,
    list_organizations,
    rename_organization,
    switch_organization,
    update_organization_member_role,
)
from app.shared.response import success_response

router = APIRouter(prefix="/api/v1/organizations", tags=["organizations"])


@router.get("")
async def get_organizations(user=Depends(get_current_user)):
    return success_response("Organizations retrieved", [
        OrganizationDetails(**dict(row)).model_dump() for row in list_organizations(user["id"])
    ])


@router.get("/{organization_id}")
async def get_organization_detail(organization_id: str, user=Depends(get_current_user)):
    try:
        organization = dict(get_organization(user["id"], organization_id))
        organization["members"] = [
            OrganizationMember(**dict(row)).model_dump()
            for row in list_organization_members(user["id"], organization_id)
        ]
    except OrganizationNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return success_response(
        "Organization retrieved", OrganizationDetail(**organization).model_dump(),
    )


@router.post("")
async def create_new_organization(body: OrganizationName, user=Depends(get_current_user)):
    try:
        organization = create_organization(user["id"], body.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Organization created", OrganizationDetails(**dict(organization)).model_dump())


@router.patch("/{organization_id}")
async def update_organization(organization_id: str, body: OrganizationName, user=Depends(get_current_user)):
    try:
        organization = rename_organization(user["id"], organization_id, body.name)
    except OrganizationNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OrganizationPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Organization updated", OrganizationDetails(**dict(organization)).model_dump())


@router.post("/{organization_id}/members")
async def invite_member(
    organization_id: str, body: OrganizationMemberInvite, user=Depends(get_current_user),
):
    try:
        member = invite_organization_member(user["id"], organization_id, body.email, body.role)
    except OrganizationNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OrganizationMemberNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OrganizationPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except OrganizationMembershipExists as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Organization member added", OrganizationMember(**dict(member)).model_dump())


@router.patch("/{organization_id}/members/{member_user_id}")
async def update_member_role(
    organization_id: str,
    member_user_id: str,
    body: OrganizationMemberRole,
    user=Depends(get_current_user),
):
    try:
        member = update_organization_member_role(
            user["id"], organization_id, member_user_id, body.role,
        )
    except OrganizationNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OrganizationMemberNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OrganizationPermissionDenied as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return success_response("Organization member updated", OrganizationMember(**dict(member)).model_dump())


@router.post("/{organization_id}/switch")
async def select_organization(organization_id: str, user=Depends(get_current_user)):
    try:
        organization = switch_organization(user["id"], organization_id)
    except OrganizationNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return success_response("Organization switched", OrganizationResponse(**dict(organization)).model_dump())
