const zendesk = require('node-zendesk');
const apiUtils = require('../../../lib/zendesk-uploader/api-utils');

describe('api-utils', () => {
    const sandbox = sinon.sandbox.create();
    before(() => {
        this.zendeskClient = zendesk.createClient({
            username: 'username',
            token: 'token',
            remoteUri: 'uri',
            helpcenter: true,
            disableGlobalState: true
        });
    });
    beforeEach(() => {
        process.env.ZENDESK_API_USERNAME = 'username';
        process.env.ZENDESK_API_TOKEN = 'token';
        process.env.ZENDESK_URL = 'url';
    });
    afterEach(() => {
        delete process.env.ZENDESK_API_USERNAME;
        delete process.env.ZENDESK_API_TOKEN;
        delete process.env.ZENDESK_URL;
        delete this.response;
        sandbox.restore();
    });
    describe('getClient', () => {
        it('should create an instance of the zendesk API client', () => {
            sandbox.spy(zendesk, 'createClient');
            apiUtils.getClient();
            expect(zendesk.createClient).to.have.been.called;
        });

        it('should remove trailing slashes from the provided zendesk URI', () => {
            process.env.ZENDESK_URL = 'http://www.url.com//';
            sandbox.spy(zendesk, 'createClient');
            apiUtils.getClient();
            expect(zendesk.createClient)
                .to.have.been.calledWithMatch({remoteUri: 'http://www.url.com/api/v2/help_center'});
        });

        it('should throw an error if Zendesk Username is not defined', () => {
            delete process.env.ZENDESK_API_USERNAME;
            expect(() => apiUtils.getClient()).to.throw(/Username is undefined/);
        });

        it('should throw an error if Zendesk Token is not defined', () => {
            delete process.env.ZENDESK_API_TOKEN;
            expect(() => apiUtils.getClient()).to.throw(/Token is undefined/);
        });

        it('should throw an error if Zendesk API Url is not defined', () => {
            delete process.env.ZENDESK_URL;
            expect(() => apiUtils.getClient()).to.throw(/Url is undefined/);
        });
    });

    describe('setSectionAccessPolicy', () => {
        beforeEach(() => {
            this.policy = {
                access: {
                    viewableBy: 'staff'
                }
            };
            this.response = {
                'access_policy': {
                    'viewable_by': 'staff'
                }
            };
        });
        it('should fulfill a promise and return the updated access policy on successful update', () => {
            const params = {
                sectionId: 123,
                meta: this.policy
            };
            sandbox.stub(this.zendeskClient.accesspolicies, 'update').yields(null, null, this.response);

            return expect(apiUtils.setSectionAccessPolicy(params, this.zendeskClient))
                .to.have.become(this.response);
        });

        it('should reject the promise with an error if the api returns an error', () => {
            const error = {error: 'error'};
            const params = {
                sectionId: 123,
                meta: this.policy
            };
            sandbox.stub(this.zendeskClient.accesspolicies, 'update').yields(error);

            return expect(apiUtils.setSectionAccessPolicy(params, this.zendeskClient))
                .to.be.rejectedWith(error);
        });

        it('should fulfill a promise and return nothing if the metadata has no access policy', () => {
            const params = {
                sectionId: 123,
                meta: {}
            };

            return expect(apiUtils.setSectionAccessPolicy(params, this.zendeskClient))
                .to.become();
        });

        it('should fulfill a promise and return nothing if the access policy has no valid properties', () => {
            const params = {
                sectionId: 123,
                meta: {
                    access: {
                        someRandomProperty: 'value'
                    }
                }
            };

            return expect(apiUtils.setSectionAccessPolicy(params, this.zendeskClient))
                .to.become();
        });

        it('should set the `viewable_by` property to the request if it was available', () => {
            this.policy.access.viewableBy = 'everyone';
            const params = {
                sectionId: 123,
                meta: this.policy
            };
            sandbox.stub(this.zendeskClient.accesspolicies, 'update').yields(null, null, this.response);

            return apiUtils.setSectionAccessPolicy(params, this.zendeskClient)
                .then(() => {
                    expect(this.zendeskClient.accesspolicies.update)
                        .to.have.been.calledWithMatch(sinon.match.any, {
                            'access_policy': {
                                'viewable_by': 'everyone'
                            }
                        });
                });
        });

        it('should set the `manageable_by` property to the request if it was available', () => {
            this.policy.access.manageableBy = 'everyone';
            const params = {
                sectionId: 123,
                meta: this.policy
            };
            sandbox.stub(this.zendeskClient.accesspolicies, 'update').yields(null, null, this.response);

            return apiUtils.setSectionAccessPolicy(params, this.zendeskClient)
                .then(() => {
                    expect(this.zendeskClient.accesspolicies.update)
                        .to.have.been.calledWithMatch(sinon.match.any, {
                            'access_policy': {
                                'manageable_by': 'everyone'
                            }
                        });
                });
        });
    });
});