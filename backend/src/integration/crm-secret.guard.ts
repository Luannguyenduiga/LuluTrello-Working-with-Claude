import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { AppRequest } from '../common/decorators';

/**
 * Guards the CRM integration routes. The caller is another service (the Lyno
 * CRM), not a person, so there is no user session to check - it authenticates
 * with a shared secret in the `x-crm-secret` header, the same shape Lulu already
 * uses for the Zalo operator routes.
 *
 * With `CRM_API_SECRET` unset the routes stay closed rather than open, so the
 * integration is off until an operator deliberately configures a secret.
 */
@Injectable()
export class CrmSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AppRequest>();
    const expected = (this.config.get<string>('CRM_API_SECRET') || '').trim();

    if (!expected) {
      throw new UnauthorizedException('CRM integration is disabled: CRM_API_SECRET is not set');
    }

    const header = request.headers['x-crm-secret'];
    const provided = Array.isArray(header) ? header[0] : header || '';

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid or missing x-crm-secret header');
    }
    return true;
  }
}
