import {app} from '../../app.js';
import {getActivityIcon, getActivityText, getEventHumanTime, getEventUser} from './activity-helpers.js';


export class ActivityItemElement extends HTMLLIElement {
    set activityEvent(event) {
        this._activityEvent = event;
        this.render();
    }

    get activityEvent() {
        return this._activityEvent;
    }

    static getText(event) {
        return getActivityText(event);
    }

    render() {
        const event = this._activityEvent;

        if (!event) {
            return;
        }

        const user = getEventUser(event);
        const objectId = event.details?.objectId;
        const isExistingObjectEvent = objectId && app.objects.some(object => object.id === objectId);
        const time = document.createElement('time');
        const avatar = document.createElement('span');
        const kindIcon = document.createElement('span');
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const text = document.createElement('span');

        this.className = `activity-item${isExistingObjectEvent ? ' has-object-link' : ''}`;
        this.style.setProperty('--activity-color', user.color);

        if (isExistingObjectEvent) {
            this.dataset.objectId = objectId;
            this.tabIndex = 0;
            this.title = 'Highlight object';
        } else {
            delete this.dataset.objectId;
            this.removeAttribute('tabindex');
            this.removeAttribute('title');
        }

        time.textContent = getEventHumanTime(event);

        avatar.className = 'activity-avatar';
        avatar.textContent = user.initials;

        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('fill', 'none');
        icon.innerHTML = getActivityIcon(event.kind);

        kindIcon.className = 'activity-kind-icon';
        kindIcon.setAttribute('aria-hidden', 'true');
        kindIcon.appendChild(icon);

        text.className = 'activity-text';
        text.textContent = ActivityItemElement.getText(event);

        if (event.count > 1) {
            const count = document.createElement('em');
            count.textContent = ` ×${event.count}`;
            text.appendChild(count);
        }

        this.replaceChildren(time, avatar, kindIcon, text);
    }
}

if (!customElements.get('activity-item')) {
    customElements.define('activity-item', ActivityItemElement, {extends: 'li'});
}
